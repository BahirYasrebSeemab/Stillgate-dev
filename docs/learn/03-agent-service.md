# Learn: `packages/agent-service`

> **In one sentence:** the agent is the invisible guard on each visitor PC. It runs as a Windows service with full power (SYSTEM), keeps the lock state, talks to the manager, and enforces the rules.

**Analogy:** the kiosk shell is the **receptionist** at the front desk. Friendly, but with no keys. The agent is the **security guard** in the back room: it holds every key, never talks to visitors directly, and only follows orders from the manager (or from the receptionist, for a few narrow things).

**Python mapping:** it's like a long-running Python daemon. `asyncio` is replaced by Node's event loop, `subprocess.run([...])` by `execFile(file, [args])`, and Pydantic by zod.

---

## How it starts (`main.ts` → `agent.ts`)
1. Work out the data folder (`paths.ts`): `%ProgramData%\AsdLabLock`, or `$ASD_DATA_DIR` in development.
2. Load `config.json` (`config.ts`). The safe defaults are `dryRun: true` and `enforcement: "audit"`.
3. Load `state.json`, and run the **boot rule** from `shared`: start LOCKED, unless it's the same boot or a MAINTENANCE.
4. Build every part and wire them together (`agent.ts` is the wiring diagram).
5. Write a fresh random **token** to `shell\shell-token`, start the loopback server, run the boot effects, start the 1-second timer, connect to the server, and start the process watcher.
6. On SIGINT/SIGTERM, stop everything cleanly.

## The folders

| Folder / file | Job |
|---|---|
| `deps.ts` | `Clock` interface + real clock. Tests pass a `FakeClock` instead ("dependency injection", like FastAPI `Depends`, but by hand). |
| `paths.ts` | Where files live. |
| `config.ts` | Config schema (zod) + `ConfigStore`. Changes go through `update(fn)`, which returns a **new** object (no mutation) and saves it atomically. A corrupt config is moved aside and the agent starts **unpaired**, so nothing can unlock. |
| `state/runner.ts` | Holds the lock state. Each event goes through the pure `reduce` from `shared`, then the effects run. Events are processed **one at a time** (a promise queue), so two commands can't interleave. |
| `state/persist.ts` | Saves and loads `state.json` with the boot marker. |
| `effects.ts` | Carries out effects: switch shell, restart, apply/remove lockdown, save, report. **Safety rule:** no RESTART unless the shell change was verified. |
| `commands.ts` | What each manager command does (unlock, lock, extend, rearm, policy, password_update, power). |
| `control.ts` | How the admin CLI talks to the running service: it drops a small JSON request file into `control\`, and the service picks it up within 1 s. |
| `cli.ts` | Admin commands: `init`, `pair`, `status`, `set-enforcement`, `set-dry-run`, `rearm`. |

### `windows/`: everything that touches Windows (all **UNTESTED(windows)**)

| File | Job |
|---|---|
| `exec.ts` | The **only** way to run a Windows tool: `reg`, `shutdown`, `taskkill`, `icacls`, `powershell`, by **absolute path** in System32 (never via `PATH`), with an **argument array** (no shell, so no injection). In **dry-run**, commands that change the machine are only logged. On Linux it refuses politely. |
| `registry.ts` | Typed wrapper over `reg.exe`: `query`, `setString`, `setDword`, `deleteValue`, `deleteKey`, `load`, `unload`. Each method builds an argument array. |
| `kiosk-hive.ts` | The kiosk user's personal registry is only "mounted" while they're signed in. If it isn't, it mounts their `NTUSER.DAT` with `reg load`, does the work, and runs `reg unload`. |
| `shell-switch.ts` | Sets the kiosk user's `Shell` to the kiosk shell, or to `explorer.exe` for maintenance. It writes, **reads back**, and only reports success if they match. |
| `lockdown.ts` | Writes or removes the Edge policies (`HKLM\SOFTWARE\Policies\Microsoft\Edge`) and the kiosk user's restrictions: no Task Manager, no Lock, no Change password, no regedit, no Sign out. |
| `power.ts` | `shutdown.exe /r` (restart), `/s` (shut down), `/a` (abort), `/t` (delay), `/c` (message). |

### `enforcer/`: closing programs that aren't allowed
- `processes.ts`: lists every process with its path and owner. **This was rewritten after testing on real Windows**, which found three bugs:
  1. Process id **0** exists (System Idle Process), and our schema wrongly rejected it, so the whole list was thrown away.
  2. Asking WMI for each process's owner took **16 seconds** per round, far too slow for a 2-second loop.
  3. PowerShell prints in the old OEM code page, so the name `Администратор` arrived as `?????????????`.

  The fix is **one PowerShell process, started once and kept running**. Each round the agent writes `list` to its stdin and reads back one JSON line. Owners come from `Get-Process -IncludeUserName`; paths come from **one** CIM query; the two are matched by process id; output is forced to UTF-8. Result: **~0.27 s per round**.

  Lesson: the slow part was something invisible (reading `.Path` makes Windows look up every file, and starting PowerShell costs 0.9 s). Measure first, then fix.
- `decide.ts`: **pure** rules, unit-tested:
  - **MAINTENANCE:** close nothing.
  - **Always allowed:** our own shell folder.
  - **Always closed:** anything on the deny list (`cmd.exe`, `powershell.exe`, `regedit.exe`, `taskmgr.exe`, `explorer.exe`, …), even inside `C:\Windows`.
  - **Allowed:** everything else inside `C:\Windows`.
  - **LOCKED:** everything else is closed.
  - **UNLOCKED:** allow-listed apps, and Edge if sites are allowed. Everything else is closed.
- `watcher.ts`: every 2 s, it lists the processes, keeps **only the kiosk user's**, runs `decide`, and then:
  - **audit** mode: logs `would_kill` (once per process);
  - **enforce** mode: runs `taskkill /PID <n> /F`.

### `password/`: the hotkey restore
- `rate-limit.ts` (pure): 5 wrong tries → 60 s lockout, then 120, 240, 480 … max 900 s. Time comes from the **monotonic** clock, so changing the PC's clock doesn't skip a lockout.
- `restore.ts`: checks the rate limit, then the stored hash (works **offline**), then enters MAINTENANCE. **The password is never logged.**

### `server-link/`: talking to the manager
- `pinned-socket.ts`: **certificate pinning**. The normal certificate-authority system is switched off (`rejectUnauthorized: false`). On the `upgrade` event, which fires *before* `open`, the agent hashes the server's certificate (SHA-256) and compares it to the fingerprint saved at pairing. If they differ, it terminates. **Not one message** reaches the wrong server; a test proves this.
- `client.ts`, the `ServerLink` connection flow:
  1. connect **out** (visitor PCs open no ports);
  2. `hello` → `auth_challenge` → `auth_response` (an HMAC) → `auth_ok`;
  3. send `state_report`, then a heartbeat every 15 s;
  4. if the server is silent for 45 s, drop the connection;
  5. reconnect with backoff (`backoff.ts`: 1 s, 2 s, 4 s … 60 s, ±20 % jitter).

  **While offline nothing changes:** the PC keeps its state and **never unlocks itself**.
- `pair.ts`: one-time pairing. It checks the fingerprint from the pairing string, sends the code, and receives the machine id, secret, password hash and policy.

### `shell-ipc/server.ts`: talking to the kiosk shell
- A TCP server on **127.0.0.1 only**, one JSON object per line (`LineSplitter` handles TCP chunks).
- Every request must carry the token. It's compared in constant time; a wrong token closes the connection.
- **Anything that looks like HTTP is dropped**, so a web page can't talk to the agent.
- The shell sends **ids only**. `launchApp` / `openSite` answer with the path or URL from the agent's own policy, and only when UNLOCKED.

---

## Tests
- **Bun** (`bun test`): decide rules, process-list parsing, rate limit, restore guard, `reg.exe` argument arrays, `reg query` parsing, shell-switch read-back, Edge lockdown writes, runner + effects (including "no restart if the shell read-back is wrong"), shell IPC over real sockets, CLI + control requests.
- **Node** (`bun run test:node`): the TLS tests (`*.nodetest.ts`). They run on **Node's own test runner**, because Bun's TLS client behaves differently with self-signed certificates, and production runs on Node. They cover: auth works, the **wrong fingerprint sends nothing**, the wrong secret never goes online, and pairing.

## Try it locally (dry-run, nothing touches Windows)
```bash
bun run build
cd packages/agent-service
bun run dev            # starts the agent with logs in the terminal (Ctrl+C to stop)
bun run cli status     # in another terminal (same ASD_DATA_DIR) to see its state
```
- `bun run dev` sets `ASD_DATA_DIR=../../.dev-data/agent` (gitignored) and `ASD_LOG_ECHO=1`.
- For `cli` in development, set `ASD_DATA_DIR` the same way, for example: `ASD_DATA_DIR=../../.dev-data/agent node dist/cli.js status`.
