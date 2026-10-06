# Learn: `packages/manager`

> **In one sentence:** the manager is a desktop app on the 5th PC. Its hidden half (Electron's **main process**) is the server the visitor PCs connect to; its visible half (the **renderer**, a React page) is the screen the registration desk uses.

**Analogy:** a shop with a back office and a shop window.
- The **back office** (main process) has the safe, the phone line to the PCs, and the files.
- The **shop window** (renderer) only shows things and has buttons.
- Between them is a **service hatch** (the preload's IPC bridge). Only a fixed list of requests fits through it, and each one is checked.

**Python mapping:**
- The main process is like your FastAPI backend, but it talks over IPC instead of HTTP, and its "routes" are the IPC channels.
- The renderer is your React frontend.
- Pydantic validation is zod again, at every door.

---

## Electron in 4 ideas
1. **Main process** = Node.js with full power (files, network, OS). One per app.
2. **Renderer** = a Chromium page running our React UI. We give it **no Node access** (`nodeIntegration: false`, `sandbox: true`), so even a bug in the UI can't touch files or the network.
3. **Preload** = a tiny script that runs before the page and can use `contextBridge` to put a **fixed API** on `window.stillgate`. The page never gets `ipcRenderer` itself.
4. **IPC** = messages between renderer and main (`ipcRenderer.invoke` ↔ `ipcMain.handle`), like `fetch` ↔ route handler.

## Main process files (`src/main/`)

| File | Job |
|---|---|
| `index.ts` | App start: single-instance lock (a second copy would fight over the port), open the data store, start `ManagerService`, register IPC, create the tray and window. **Closing the window only hides it**; "Quit" in the tray menu stops the server. Starts with Windows when installed. |
| `window.ts` | The hardened window: no Node, sandbox, no navigation, no new windows, DevTools only in development. `isTrustedSender` checks that IPC comes from our own page. |
| `ipc.ts` | The **only** doors from UI to main. Every argument is validated with zod, so the UI is treated like untrusted input. |
| `secret-box.ts` | Encrypts secrets with Electron `safeStorage` (Windows **DPAPI**: only this Windows user on this PC can decrypt them). It refuses to run without OS encryption. |
| `store.ts` | Three JSON files in the app's data folder: `machines.json` (with **sealed** secrets), `settings.json` (port, policy, password **hash**, TLS cert + **sealed** key), `events.json` (last 5000). All use `JsonFileStore` from `shared` (atomic saves). |
| `service.ts` | **The brain.** It builds the UI snapshot and holds every action: send commands, rename, revoke, save policy (version +1, then broadcast), set password (hash, version +1, then broadcast), create pairing strings. It also handles agent callbacks: pairing, reports, events, offline. |
| `server/agent-server.ts` | The **only network listener**: `https` + `ws` on port 47800. See below. |
| `server/tls.ts` | Creates the self-signed certificate once: RSA 2048, SHA-256, **valid 20 years**, so it never expires under the PCs. The private key is stored sealed. |
| `server/guards.ts` | `PairingCodes` (one-time, 10 minutes) and `AuthLimiter` (10 failures in 5 minutes from one IP → ignored for 15 minutes). |

### How an agent connects (`agent-server.ts`)
1. The agent opens `wss://manager:47800`. A blocked IP is dropped immediately.
2. It has **10 seconds** to authenticate, or it's dropped.
3. **Login:**
   - `hello{machineId}` → the server answers `auth_challenge{random nonce}`. Unknown machines get a challenge too, so nobody can probe which ids exist.
   - `auth_response{mac}` → the server checks `HMAC(secret, nonce + id)` in constant time.
   - Right → `auth_ok`, and the PC is online. Wrong → `error auth_failed`, the IP is counted, and the connection closes.
4. **Or pairing:** `pair_request{code}` → if the code is valid **and** a restore password is set, the server creates a GUID + random secret, stores the sealed secret, and replies with `pair_result`. Then it closes.
5. **While online:**
   - `state_report`: the server remembers the latest one. If the PC's password or policy version is **behind**, it sends the newer one, so offline PCs catch up when they reconnect.
   - `event`: written to the event log.
   - `heartbeat`, plus ws ping/pong every 15 s; a silent PC is dropped.
6. A newer connection for the same machine replaces the old one.

## Preload (`src/preload/index.ts`)
It exposes `window.stillgate` with exactly the `ManagerApi` functions.
- **Trap:** a sandboxed preload may only `require("electron")`, so it imports our shared types with `import type`, which is erased at compile time.
- Channel names are **string-literal types** (`"stillgate:command" | …`), so a typo is a compile error on both sides.

## Renderer (React UI, `src/renderer/`)
- `api.ts`:
  - `useSnapshot()` loads the state once, then listens for pushes from main (throttled to 4 per second);
  - `useNow()` ticks every second, so countdowns move without asking main.
- `pages/MachinesPage.tsx`: the table (online dot, state badge, time left, last seen, synced/pending, dry-run/audit tags) and the multi-select toolbar: Unlock 1 h / 2 h / custom, Extend, Lock now, End maintenance, Restart, Shut down. Restart and shut down ask for confirmation.
- `pages/PolicyPage.tsx`: the allow-list editor. It validates each entry with the **same zod schemas** the server and agents use. `key={policy.version}` resets the form after each save.
- `pages/SettingsPages.tsx`: restore password, pairing (choose this PC's IP → pairing string + Copy), and the event log.
- `strings.ts`: **all UI text in one place**, ready for Russian or Tajik later.
- **Content-Security-Policy** (added at build time in `vite.config.mts`): the page may only load its own files and **may not connect anywhere** (`connect-src 'none'`).

## Build setup

| Config | What it covers | Why |
|---|---|---|
| `tsconfig.json` | main + preload + common, compiled by `tsc` | CommonJS output for Electron |
| `tsconfig.renderer.json` | the UI, **type-check only** | DOM types, `jsx: react-jsx`, `moduleResolution: Bundler`; Vite bundles it |
| `vite.config.mts` | builds the UI into `dist/renderer` | `.mts` forces ESM for the config file. `@stillgate/shared` is aliased to its **TypeScript source**, because its `dist/` is CommonJS made for Node, and Vite wants ESM |
| `electron-builder.yml` | the Windows installer (`bun run dist`) | **run on Windows** |

**Electron 44 note:** it no longer downloads its binary in an install script, so `trustedDependencies` isn't needed. The binary is fetched on demand: run `bun x install-electron` inside `packages/manager` before `bun run start`.

## Tests
- **Bun:** `server/guards.test.ts` (codes work once and expire; IP blocking and window).
- **Node** (`e2e.nodetest.ts`), the **end-to-end test**: the real agent link code against the real manager server, over TLS on 127.0.0.1:
  - no pairing string before a password exists;
  - pairing works, and the **same code can't be used twice**;
  - the agent goes online and shows LOCKED, then **unlock** is delivered;
  - a **policy** save reaches the agent, and its report marks it "synced";
  - an **impostor with the wrong secret** never gets online;
  - an invalid policy (`*`) is refused;
  - revoke removes the PC.

## Run it (development)
```bash
bun run build                      # from the repo root: shared + agent + manager (+ UI)
cd packages/manager
bun x install-electron             # once: downloads Electron's binary
bun run start                      # opens the manager (on WSL needs WSLg; best on Windows)
```
