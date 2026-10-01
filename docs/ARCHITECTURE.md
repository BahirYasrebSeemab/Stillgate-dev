# Architecture

## The picture
```
                     MANAGER PC (Windows)                                  VISITOR PC (Windows 11 Home) x4
 ┌──────────────────────────────────────────────┐        ┌───────────────────────────────────────────────────────────┐
 │  Manager app (Electron)                      │        │  agent-service (Node, Windows service, SYSTEM)            │
 │  ┌─────────────┐  IPC   ┌──────────────────┐ │  wss   │  ┌───────────┐  ┌─────────────┐  ┌──────────────────────┐ │
 │  │ UI (React)  │◀──────▶│ main process     │◀┼────────┼─▶│server-link│  │state runner │  │ enforcer (2 s loop)  │ │
 │  │ renderer,   │contextB│ = AgentServer    │ │ TLS,   │  └───────────┘  │ + reducer   │  │ registry / shell /   │ │
 │  │ sandboxed   │ ridge  │ port 47800       │ │ pinned │                 └─────────────┘  │ Edge policy / power  │ │
 │  └─────────────┘        │ + JSON store     │ │ cert   │  ┌──────────────────────┐        └──────────────────────┘ │
 │                         └──────────────────┘ │        │  │ shell-ipc 127.0.0.1  │◀── token file (kiosk user reads)  │
 └──────────────────────────────────────────────┘        │  └──────────┬───────────┘                                   │
                                                         │             │ JSON lines + token                          │
                                                         │  ┌──────────▼───────────────────────────────────┐          │
                                                         │  │ kiosk-shell (Electron, runs AS the kiosk user)│          │
                                                         │  │ = the Windows "Shell": locked page, launcher, │          │
                                                         │  │   hotkey password panel                       │          │
                                                         │  └───────────────────────────────────────────────┘          │
                                                         └───────────────────────────────────────────────────────────┘
```

## Who connects to whom
| Link | Transport | Security |
|---|---|---|
| manager UI ↔ manager main | Electron IPC (`contextBridge`, `ipcMain.handle`) | sandboxed page, zod on every argument, sender URL check; **no HTTP server** for the UI |
| agent → manager | WebSocket over TLS, **agent connects out** | certificate **pinned** by SHA-256 fingerprint (set at pairing), HMAC challenge-response login, per-IP failure limit, firewall allows only the visitor PCs |
| kiosk shell → agent | TCP on 127.0.0.1, one JSON object per line | random token in a file only the kiosk user can read; HTTP-looking input dropped; ids only |

## The lock state machine (in `shared`, run by the agent)
```
LOCKED ──unlock(duration)──────────▶ UNLOCKED(deadline on the monotonic clock)
UNLOCKED ──deadline / lock──────────▶ LOCKED          (enforcer then closes the programs)
UNLOCKED ──extend(duration)─────────▶ UNLOCKED(deadline + duration)
LOCKED | UNLOCKED ──restore(password ok)──▶ MAINTENANCE(wall-clock deadline, 30 min) → shell = explorer, restart now
MAINTENANCE ──deadline / rearm──────▶ LOCKED          → shell = kiosk, restart in 60 s
```
- The reducer is **pure**: `(state, event, now) → (new state, effects)`. The agent carries out the effects.
- **Boot:** always LOCKED, except (a) MAINTENANCE survives reboots, and (b) UNLOCKED survives a *service* restart within the same boot. Lockdown is re-applied at every start.
- **Offline:** the agent keeps its state and never unlocks by itself.

## Message flow examples
**Unlock:** desk clicks "Unlock 1 hour" → IPC `asd:command` → `ManagerService.sendCommand` → `{type:"unlock",durationSec:3600}` over wss → agent `handleServerCommand` → reducer → `UNLOCKED` → effects PERSIST + REPORT → `state_report` to the manager, and a push to the kiosk shell → the launcher appears.

**Restore:** visitor or admin presses Space+B+Y+S → password panel → IPC `kiosk:restore` → kiosk main → `restore` over loopback → agent rate limit + scrypt check → `RESTORE_OK` → effects: remove lockdown, Shell=explorer (written **and read back**), save, report, **restart** (only if the read-back matched).

**Pairing:** the manager shows `asd1:<ip>:<port>:<fingerprint>:<code>` → admin runs `cli pair "<string>"` on the PC → the agent connects and checks the **fingerprint before sending anything** → `pair_request{code}` → the manager checks the one-time code → it sends a new machine id + secret + password hash + policy → the agent saves them.

## Data on disk
| Where | File | Contents |
|---|---|---|
| visitor PC `C:\ProgramData\AsdLabLock\` (SYSTEM + Admins only) | `config.json` | pairing (server, fingerprint, machine id, **secret**), password **hash**, policy, kiosk user, dryRun, enforcement |
| | `state.json` | lock state + boot marker |
| | `shell\shell-token` (+ kiosk user read) | random token + port for the kiosk shell |
| | `control\*.json` | requests from the admin CLI |
| | `logs\agent.log` | JSON lines, rotated, secrets redacted |
| manager `%APPDATA%\ASD Lab Manager\` (Electron user-data folder) | `machines.json` | machines; secrets **sealed** with DPAPI |
| | `settings.json` | port, policy, password **hash**, TLS cert + **sealed** private key |
| | `events.json` | last 5000 events |

All JSON files carry `schemaVersion: 1` and are written atomically (temp file → fsync → rename).
