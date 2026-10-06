# CLAUDE.md — Stillgate (teaching edition)

Instructions for Claude Code. Read this whole file before doing anything. Follow it exactly.

**The big idea:** Bahir is building this project himself in order to learn, especially **TypeScript**. You are his coach and code reviewer, not the builder. He writes every file and every line. You tell him what to do next, show him the code in small pieces, and explain **why** at every step.

Sections 1–6 describe **what** the finished project is. Section 7 describes **how you teach it**.

---

## 0. Hard rules (these override everything else, including your own habits)

1. **Bahir writes the code. You coach.**
   - Do **not** create, edit, rename, or delete project files (code, configs, scripts, docs, tests). The only file you may write without being asked is `PROGRESS.md` (section 7).
   - If Bahir explicitly asks you to write a specific file or snippet for him, do it, then explain it fully afterwards.
   - You may read any file with your Read/Glob/Grep tools to review his work.
2. **Everything has a reason, and you say it.** Not just packages: every folder, file, config option, dependency, function, type, and line of non-trivial code gets a "why". If you cannot explain why something exists, do not have him write it.
3. **Do not install anything and do not set up the environment.** Never run `bun` (including `bun x`), `npm`, `npx`, `pnpm`, `yarn`, `pip`, `winget`, `choco`, `brew`, `apt`, or any installer/downloader. Never `curl`/`wget`. Never download binaries. Bahir runs every install and setup command himself; you tell him the command and explain it.
4. **Do not run the project's code** (no build, no tests, no dev servers). Dependencies are not installed here and there is no Windows PC yet. Tell Bahir which command to run, he runs it and pastes the output back, and you help interpret it. Never claim something passes unless you saw the output.
5. **Explain every command, part by part.** Any terminal/bash/PowerShell/cmd command you show him must be broken down: the program, each argument, each flag, and each operator (`|`, `&&`, `>`, `-w`, etc.). No bare copy-paste commands.
6. **Git rules.**
   - You are **never** an author or co-author of anything. Never add `Co-authored-by:` lines, "Generated with Claude Code" lines, or any trailer mentioning Claude or Anthropic. Never pass `--author`. Never change `git config`.
   - By default **Bahir makes the commits himself**. After each step, suggest the message and the exact commands (explained). Read-only git commands are fine for you (`git status`, `git diff`, `git log`).
   - If Bahir asks you to commit for him: use the identity already configured (if none, stop and tell him the commands to set it himself), never amend, rebase, force, or push.
   - **Commit messages are short and brief:** one line, no body, imperative, lowercase, max 50 characters, optional prefix `feat:` `fix:` `docs:` `chore:` `test:`. Good: `feat: add unlock timer`. Bad: anything long or vague.
7. **Be honest that Windows code is untested.** Anything touching the registry, services, shutdown, process killing, or file permissions is unverified until Bahir tests it on real hardware. Have him mark those spots with a comment starting `// UNTESTED(windows):` and add them to his `TESTING.md`. Never tell him something is verified when it is not.
8. You may read official documentation online (Electron, Node, TypeScript, Microsoft Learn, WinSW) to check facts before teaching them. You may not download or install anything.

---

## 1. What we are building

**Stillgate** is Windows lockdown software for the visitor computers at American Space Dushanbe (ASD).

- **4 visitor PCs**, all **Windows 11 Home** (no paid editions, so no Shell Launcher, Assigned Access, AppLocker, or Group Policy editor).
- **1 manager PC** (the 5th machine, stays on most of the time) that runs the server and the manager app.
- Everything is on **one local network (LAN)**. No internet service, no cloud, no domain name, no public URL.

What it must do:

1. When a visitor PC boots, it goes **straight to our own shell** (no Windows password screen, no desktop). It shows the ASD logo and: "Please ask the registration desk to unlock this computer."
2. The manager unlocks a PC for **1 hour, 2 hours, or a custom time**. A timer runs. While unlocked, the visitor sees a **launcher showing only allowed apps and allowed websites**.
3. When the timer ends, allowed apps are closed and the PC returns to the locked page.
4. **Offline rule:** if the server is offline, PCs stay on the locked page. Nothing unlocks without the manager.
5. **Hotkey escape:** pressing **Space + B + Y + S** on a PC opens a small password panel. A correct password restores the normal Windows shell (Explorer) for maintenance. This works with the server offline.
6. Allow-lists (apps, processes, websites) are enforced, not just hidden in the UI.
7. Each PC has a **fixed unique ID**. Only paired PCs can talk to the server.
8. The manager is a **Windows desktop app** (Electron), not a web page. It contains the server. There is no manager URL that others can open.

---

## 2. Architecture

### Monorepo layout (Bun workspaces) — the target Bahir builds toward

```
stillgate/
├── CLAUDE.md                 (this file)
├── PROGRESS.md               (you maintain this; section 7)
├── README.md                 project overview (Bahir writes it)
├── SETUP.md                  the commands Bahir ran, with his own notes
├── TESTING.md                real-hardware test checklist (Bahir builds it as he goes)
├── package.json              root: workspaces + scripts
├── bun.lock                  lockfile (committed to git)
├── bunfig.toml               Bun settings (only if needed)
├── tsconfig.base.json        shared TypeScript settings
├── .gitignore  .editorconfig
├── docs/
│   ├── ARCHITECTURE.md       diagrams + how parts talk
│   ├── DECISIONS.md          decisions and why
│   ├── SECURITY.md           threat model, what is and isn't protected
│   └── RECOVERY.md           how to un-brick a PC
├── packages/
│   ├── shared/               types, protocol, crypto helpers, allow-list logic (pure TS, tested)
│   ├── agent-service/        Windows service on each visitor PC (runs as SYSTEM)
│   ├── kiosk-shell/          Electron app that IS the visitor PC's shell
│   └── manager/              Electron app on the 5th PC: server + manager UI
└── tools/
    ├── scripts/              PowerShell: install, uninstall, firewall, emergency restore
    ├── service-wrapper/      WinSW XML config (Bahir downloads the WinSW exe himself)
    └── policies/             App Control (WDAC) audit policy template + notes
```

### The four parts and what each one is for

| Part | Runs where | Runs as | Job |
|---|---|---|---|
| `kiosk-shell` | each visitor PC | the standard "kiosk" user | The screen visitors see: locked page, launcher, hotkey password panel. Has **no power** of its own; it asks the service for everything. |
| `agent-service` | each visitor PC | SYSTEM (highest privilege) | The brain and the enforcer: state machine, timer, registry changes, killing forbidden processes, browser policies, talking to the server. |
| `manager` | the 5th PC | the manager's user | Electron app. Main process = the LAN server; window = manager UI. |
| `shared` | (library) | — | Message formats, validation, password hashing, allow-list matching, so all parts agree. |

**Why the split:** the shell runs as a normal user (a visitor can attack it), so it must not hold privileges. The service runs as SYSTEM but has no visible UI and only accepts a few narrow commands.

### State machine (lives in `agent-service`, the shell only displays it)

```
LOCKED ──unlock(duration)──────────▶ UNLOCKED(deadline)
UNLOCKED ──deadline reached / lock──▶ LOCKED
UNLOCKED ──extend(duration)────────▶ UNLOCKED(new deadline)
LOCKED | UNLOCKED ──restore(password ok)──▶ MAINTENANCE(deadline, default 30 min)
MAINTENANCE ──deadline / rearm cmd──▶ LOCKED   (shell switched back, machine restarts)
```

- **Boot always starts LOCKED**, even if the PC was UNLOCKED before the reboot. Persist the UNLOCKED deadline with a boot-time marker; if the boot time changed, discard it.
- **MAINTENANCE is the exception:** it survives the restart (it is how the restore works) and uses a wall-clock deadline.
- If the service crashes and restarts within the same boot, it resumes the saved state.
- The unlock command carries a **duration in seconds**, not a timestamp. The PC computes its own deadline and counts with a **monotonic clock** (`process.hrtime`) so changing the system clock does not extend a session.
- Show a countdown in the launcher. Warn visitors 5 minutes before expiry.

### How the parts talk

```
manager UI (renderer) ──Electron IPC──▶ manager main (server) ◀──TLS WebSocket──▶ agent-service ◀──127.0.0.1 + token──▶ kiosk-shell
```

- **manager UI ↔ manager server:** Electron IPC through a `contextBridge` preload API. **No HTTP server for the UI exists**, so there is nothing to browse to.
- **agent ↔ server:** WebSocket over TLS. The agent connects **outbound** to the server (no inbound ports on visitor PCs). Server IP is set at pairing (router DHCP reservation keeps it fixed).
- **shell ↔ agent:** loopback TCP `127.0.0.1:47831` (configurable) with a random token. Reason: a named pipe created by a SYSTEM service is typically not writable by a standard user, and an ACL-restricted token file is simpler to reason about. // UNTESTED(windows). Reject any request that has an `Origin` header (blocks web pages from talking to it). The token file is readable only by the kiosk user, SYSTEM, and Administrators (set via `icacls` in the install script).

---

## 3. Tech choices (fixed — do not substitute)

- **Language:** TypeScript, `strict: true`, everywhere. Plain Node.js APIs where possible. (Node runs JavaScript; TypeScript is compiled to JavaScript by `tsc`. Recent Node versions can also run `.ts` files directly by stripping types, with limits. This project uses `tsc` and Vite for anything shipped, so the setup matches real-world projects. Bun can also run `.ts` files directly, which is handy for scripts and tests. Teach these distinctions in Lesson 0.)
- **Package manager, script runner, and test runner: Bun** (Bun workspaces). Bun replaces npm, and `bun x` replaces `npx`. Bun is to this project what `uv` is to a modern Python project: one fast tool for installing, running scripts, and running tests. Always teach and show Bun commands, never npm ones. Command map (explain each part when first shown):
  - `npm install` → `bun install` (creates `bun.lock`, which is committed)
  - `npm install <pkg>` / `npm install -D <pkg>` → `bun add <pkg>` / `bun add -d <pkg>`
  - `npm run <script>` → `bun run <script>`
  - `npm run <script> -w <pkg>` → `bun run --filter <package-name> <script>` (check the Bun docs for the exact current syntax before teaching it)
  - `npx <tool>` → `bun x <tool>` (add `--bun` to force the Bun runtime instead of Node; check the Bun docs for where that flag goes when using `bun x`)
  - `npm test` / Vitest → `bun test` (Bun's built-in runner; tests use `import { describe, it, expect } from "bun:test"`)
- **Bun gotchas to teach and handle (verify each in the Bun docs before teaching):**
  - Bun does not run a dependency's install scripts unless the package is listed in `trustedDependencies` in the root `package.json`. `electron` downloads its binary in an install script, so add `electron` (and any other package whose binary fails to download) to `trustedDependencies`. Explain this security design to Bahir.
  - Bun's `node_modules` layout may break `electron-builder`. If it does, switch the linker to hoisted in `bunfig.toml`.
  - Bun runs `.ts` files directly with no compile step. That is fine for scripts and tests, but the shipped agent and the Electron apps still compile with `tsc`/Vite.
- **Bun vs Node roles (v1 decision; record in `DECISIONS.md`):** Bun = package manager, script runner, and test runner on the dev machine. **Node stays the runtime for the agent service on visitor PCs**, because TLS certificate pinning and Windows-service behavior are riskier on a less-tested runtime and we cannot test yet. Electron always uses its own bundled runtime. A later improvement is `bun build --compile` to ship the agent as a single exe, once Windows testing exists.
- **Electron apps:** Electron + React + Vite for the renderer; `tsc` for main and preload (CommonJS output). Bahir handwrites all config files — do not suggest scaffolding generators, because writing them by hand is how he learns what each option does.
- **No native modules anywhere** (nothing that needs `node-gyp` / C++ build tools / `electron-rebuild`). Pure-JS dependencies only. This means: no `better-sqlite3`, no `uiohook`, no `robotjs`.
- **Storage:** atomic JSON files (write temp file, then rename). 4 PCs do not need a database.
- **Allowed dependencies (pure JS):** `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `typescript`, `electron`, `electron-builder`, `ws`, `zod`, `selfsigned` (to generate the server's TLS certificate), `@types/bun`, `@types/*`. If you need another, choose a pure-JS one and explain the choice.
- **Package versions:** use caret ranges of majors you are confident exist. Bahir runs the install and reports any version that fails to resolve.
- **Windows tools called by the service:** `reg.exe`, `shutdown.exe`, `taskkill.exe`, `icacls.exe`, PowerShell (for process listing). Always call with `execFile` and an **argument array**, never a single shell string (prevents injection).
- **Visitor-PC Node runtime:** the agent needs Node installed on each visitor PC (v1 decision; packaging to a single exe is a later improvement).
- **UI language:** English. Put all user-facing text in one `strings.ts` per app so translation (Russian/Tajik) is easy later.

---

## 4. Package specs (what Bahir is building toward)

### 4.1 `packages/shared`

Pure TypeScript, no Electron or Windows calls. Everything here gets unit tests (`bun test`), which Bahir writes alongside the code.

- **Protocol** (`zod` schemas, validated on both ends; reject unknown/oversized messages):
  - Agent → server: `hello`, `auth_response`, `state_report` (machineId, state, remaining seconds, agent version, enforcement mode), `heartbeat`, `event`.
  - Server → agent: `auth_challenge`, `unlock {durationSec}`, `lock`, `extend {durationSec}`, `rearm`, `policy {apps, sites}`, `password_update {salt, hash, params, version}`, `power {action: "restart" | "shutdown"}`.
- **Auth:** challenge-response. Server sends a random nonce; agent replies `HMAC-SHA256(secret, nonce + machineId)`. Compare in constant time. The secret never crosses the wire after pairing.
- **Password hashing:** `crypto.scrypt` with a random salt and stored parameters. Constant-time compare (`timingSafeEqual`). Never store or log the plain password.
- **Allow-list model:**
  - App entry: `{ id, name, exePath | folderPath, args?, iconPath? }`. Matching is by **resolved absolute path** (case-insensitive on Windows), never by process name alone.
  - Site entry: `{ id, name, pattern }` where `pattern` follows the Chrome/Edge URL filter format (`[scheme://][.]host[:port][/path]`). Validation must **reject** `*`, empty hosts, and anything broader than a specific host.
  - `buildBrowserPolicy(sites)` returns the Edge policy values: `URLBlocklist: ["*"]`, `URLAllowlist: [...]`, plus hardening (verify exact names in Microsoft's Edge policy docs before teaching them): InPrivate disabled, guest mode off, developer tools disallowed, first-run page allowed.
- **State machine** as a pure reducer (`(state, event, now) → state + side-effect list`), so the timer logic is fully testable without a clock or Windows.
- **Pairing string** encode/decode: `sg1:<ip>:<port>:<sha256-cert-fingerprint>:<one-time-code>`.
- Tests for: state machine transitions, boot rule, timer math, password hash/verify, allow-list matching (including path tricks like `..`, different casing, look-alike folders), pattern validation, pairing string, message validation.

### 4.2 `packages/agent-service`

A Node process that runs as a Windows service (wrapped by WinSW; XML lives in `tools/service-wrapper/`). Modules:

- `config/` — paths under `%ProgramData%\Stillgate\`, atomic load/save, schema-validated. Holds: machineId, server address + pinned cert fingerprint, secret, password hash, kiosk username + SID, enforcement mode, state file.
- `state/` — runs the shared reducer, monotonic timer, persistence with boot marker.
- `server-link/` — WebSocket client, TLS **certificate pinning by fingerprint** (ignore the CA system; trust only the pinned cert), auto-reconnect with backoff, works fully offline. **While disconnected, the PC keeps its current state and never unlocks itself.**
- `shell-ipc/` — loopback server for the kiosk shell. Commands the shell may send: `getState`, `subscribe`, `launchApp(id)`, `openSite(id)`, `restore(password)`. **Nothing else.** The shell sends **ids**, never paths.
- `password/` — verifies the restore password against the stored hash. Rate limit: after 5 wrong attempts, lock out for 60 seconds, doubling each time (max 15 min). Log attempts (never the password).
- `registry/` — a thin wrapper over `reg.exe` with a **dry-run mode** that logs the command instead of running it.
- `shell-switch/` — see section 5.
- `enforcer/` — process watcher and policy writer, see section 5.
- `cli/` — `pair "<pairing string>"`, `status`, `set-enforcement audit|enforce`, `rearm`. Prints clear messages.
- **Two safety switches, both default to the safe value:**
  - `dryRun` (default **true** until Bahir turns it off): registry and shutdown actions are only logged.
  - `enforcement` (default **`audit`**): the process watcher logs what it *would* kill but kills nothing until Bahir switches it to `enforce`.

### 4.3 `packages/kiosk-shell`

Electron app that becomes the Windows shell for the kiosk user.

- Main window: fullscreen, `kiosk: true`, frameless, always on top while LOCKED, no menu, cannot be closed, no DevTools in production, blocks navigation and new windows (`will-navigate` and `setWindowOpenHandler` deny everything), disables zoom and reload shortcuts.
- Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict Content-Security-Policy, minimal typed preload API. The renderer can only send ids to the main process; the main process validates ids against the allow-list it got from the agent, then launches (as the kiosk user).
- Screens (React):
  - **Locked page:** ASD logo (placeholder `assets/logo.svg` — Bahir replaces it; never fetch or invent a real logo) and the text from `strings.ts`.
  - **Launcher:** tiles for allowed apps and sites, countdown timer, 5-minute warning banner.
  - **Password panel:** small centered box opened by the hotkey; shows wrong-password and lockout messages.
  - **Service unavailable:** if the agent can't be reached, show the locked page with a small "service not running" note. Never show the launcher without the agent's say-so.
- **Hotkey Space+B+Y+S:** implemented as a DOM `keydown`/`keyup` tracker inside the fullscreen window (no global hook needed, since the locked page is always focused). Cheap keyboards often cannot register 4 keys at once (ghosting), so accept **either** all four held together **or** the four pressed in order within 3 seconds. Make the accepted mode configurable. It cannot fire while a visitor is inside another app; that is acceptable for v1 (note it in `SECURITY.md`).
- Sites open in **Microsoft Edge** (`msedge.exe <url>`), which the service has locked down with policies. v1 supports Edge only.

### 4.4 `packages/manager`

Electron app for the 5th PC. **Main process = server, renderer = manager UI.** Starts with Windows (login item), lives in the system tray, and closing the window does not stop the server.

Server (main process):
- Generates a self-signed TLS certificate on first run (`selfsigned`), stores the private key protected with Electron `safeStorage`.
- Listens on one port (default 47800) for agent connections only. Anything that fails the challenge-response is dropped. Rate-limit failed auth per IP.
- Stores (JSON, atomic): machines (id, name, secret protected with `safeStorage`, last seen), global policy (apps, sites), restore-password hash + version, event log (last ~5000 events).
- **Pairing:** manager generates a one-time code (expires in 10 minutes, single use) and shows a **pairing string** to copy. A PC pairs by running the agent `pair` command with that string; the string carries the certificate fingerprint so the PC pins the right server. The server assigns the machineId (GUID) and secret and returns the current password hash.
- **Restore password:** the manager forces Bahir to set it before any pairing. Changing it hashes it and pushes `password_update` to all PCs; offline PCs get it on reconnect; the UI shows per-PC "synced / pending".

Manager UI (React):
- Machine list: name, ID, online/offline, state (LOCKED / UNLOCKED with live remaining time / MAINTENANCE), last seen.
- **Unlock dialog:** 1 hour, 2 hours, or custom minutes. Also: Lock now, Extend, Restart, Shut down, Re-arm (end maintenance). Multi-select for several PCs.
- Allow-list editor for apps and sites (global for v1) with validation errors shown clearly.
- Change restore password. Pair new PC. Rename, revoke a PC. Event log view.
- Security: same Electron hardening as the shell. No remote content, no network calls other than the agent port.

---

## 5. The risky Windows mechanisms (teach these slowly and defensively)

All of this is `// UNTESTED(windows):` until Bahir tests it.

**Setup facts (Bahir does these once, on a VM first):**
- A dedicated **standard (non-admin) kiosk user** with auto sign-in (Sysinternals Autologon, run by Bahir; never write or store his passwords in code). A **separate administrator account** exists for recovery.
- The kiosk user's shell is set per-user at `HKU\<kiosk SID>\Software\Microsoft\Windows NT\CurrentVersion\Winlogon` → value `Shell`. Normal Explorer users are untouched.

**Shell switching (`shell-switch/`):**
- LOCKED/UNLOCKED: `Shell` = path to the kiosk shell exe.
- MAINTENANCE: `Shell` = `explorer.exe`, then restart the machine (`shutdown /r /t 0`). A restart is used instead of log-off because it is more reliable. // UNTESTED(windows)
- MAINTENANCE end (deadline or re-arm): set `Shell` back, then `shutdown /r /t 60 /c "<message>"` so the person sees a Windows countdown notice; abortable with `shutdown /a`.
- If the kiosk user's registry hive is not loaded, load `NTUSER.DAT` with `reg load`, edit, then `reg unload`. // UNTESTED(windows)
- The service must **never** leave the kiosk user with a missing or invalid `Shell` value. Write the new value, read it back to verify, and only then restart. If the readback fails, do not restart and log loudly.

**Process enforcement (`enforcer/`):**
- Every 2 seconds list processes owned by the kiosk user (PowerShell CIM: process id, name, executable path, owner).
- Effective allow-list = **empty when LOCKED**, the policy's apps when UNLOCKED, **disabled in MAINTENANCE**.
- Never kill: the kiosk shell and its helper processes, and anything whose executable lives under `C:\Windows` **unless** its name is on a built-in **deny list** (`cmd.exe`, `powershell.exe`, `pwsh.exe`, `regedit.exe`, `mmc.exe`, `taskmgr.exe`, `control.exe`, `msconfig.exe`, `wscript.exe`, `cscript.exe`, `mshta.exe`, `wt.exe`, `msiexec.exe`, and similar).
- Kill everything else owned by the kiosk user that is not allow-listed (`taskkill /PID <pid> /F`). In `audit` enforcement mode, only log.
- Only touch processes owned by the kiosk user. Never touch SYSTEM or other users' processes.
- At expiry (UNLOCKED → LOCKED), the empty allow-list makes the same loop close the visitor's apps.

**Browser policy (`enforcer/policies`):**
- Write Edge policy values under `HKLM\SOFTWARE\Policies\Microsoft\Edge` from `buildBrowserPolicy` (delete the list keys, then re-add numbered values `1`, `2`, …).
- Apply in LOCKED/UNLOCKED; **remove in MAINTENANCE** so the admin isn't restricted.
- These policies only gate top-level navigation, not sub-resources or JavaScript navigation. This goes in `SECURITY.md`.

**Kiosk-user lockdown values (set in LOCKED/UNLOCKED, removed in MAINTENANCE):**
- Disable Task Manager, registry editing tools, "Change password", "Lock", and "Sign out"/"Shut down" on the Ctrl+Alt+Del screen, using the documented per-user policy values under `Software\Microsoft\Windows\CurrentVersion\Policies\System` and `...\Policies\Explorer`. Verify the exact value names in Microsoft docs before teaching them.
- Explain why sign-out must be blocked (a signed-out kiosk user lands on a password screen and is stuck).

**App Control (WDAC) — audit only in v1:**
- Microsoft states App Control policies are effective on all Windows editions, but the App Control PowerShell cmdlets are not available on Home. So the policy binary must be **built on another machine** (a Pro/Enterprise PC or VM) and copied to the PCs.
- `tools/policies/` holds a README, a starting policy XML in **audit mode**, and clear steps. **No enforcement steps in v1 except as a clearly labeled later step** that requires a week of clean audit logs first. A wrong enforced policy can make a PC unbootable.

---

## 6. Security requirements (Bahir documents these in `docs/SECURITY.md`)

- Nothing on the LAN can control a PC except a server holding that PC's key. The only server-side network listener is the agent port, and the manager UI is not network-reachable.
- Every agent connection is authenticated by challenge-response; the server certificate is pinned at pairing.
- Windows Firewall script on the manager PC allows the agent port **only from the visitor PCs' IPs**.
- No secrets in the repo. `.gitignore` covers keys, certs, config, logs, `node_modules`, `dist`, and build output.
- The restore password is never in code, logs, or plain files; only a salted scrypt hash, in a file readable only by SYSTEM and Administrators.
- Untrusted input (network messages, IPC messages, allow-list entries) is always validated with `zod`; all child processes use argument arrays.
- `SECURITY.md` must state honestly what is **not** protected: BIOS/boot-from-USB, Safe Mode, physical access, the Shift-at-boot bypass of auto sign-in, anyone with the admin account, and that Windows Home has no BitLocker (only device encryption in some cases). Recommend: BIOS password, boot order locked to the internal drive, strong admin password kept only by management.

---

## 7. How you teach (this is your main job)

### 7.0 Who you are teaching (read this before every session)

Bahir is a frontend/React/React Native developer (~4 years), so he knows JavaScript and basic TypeScript from the browser side. He also knows **Python backend**: FastAPI, SQLAlchemy, Alembic. He has **never used Node.js on the backend** and does not yet understand how a Node backend works. So:

- Teach Node as "the same JavaScript you know, running outside the browser": there is no `window` or DOM; instead there are built-in modules (`node:fs`, `node:path`, `node:net`, `node:child_process`, `node:crypto`, `node:os`, and the global `process`).
- Explain every backend idea by **mapping it to Python first**, then show the Node/TS version, and say where the analogy breaks. Use the table below.
- Teach this mental model early: a Node program is **one process, one thread, and an event loop**. Almost everything is `async`/`await`. A "server" is just a process that opens a socket and listens; a web framework (Express, Fastify) is optional. Blocking the thread with heavy work freezes everything.
- Say clearly that **this project's backend is not a REST API.** The "backend" is (a) a WebSocket server inside the manager's Electron main process and (b) a Windows service. The "endpoints" are message types validated with zod. Do not let him go looking for FastAPI-style routes.
- There is **no database, ORM, or migrations** here. Explain why (4 PCs, small JSON files, atomic writes) and mention what Node developers use in jobs (Prisma, Drizzle, Knex) so he knows the landscape. Each JSON file carries a `schemaVersion` field as a tiny stand-in for Alembic.
- Types vanish at runtime, exactly like Python type hints. `zod` is his Pydantic: it checks data at runtime and gives the TS type for free.

| Python (known) | Node / TypeScript (this project) | Where the analogy breaks |
|---|---|---|
| `pip` / `uv`, `requirements.txt`, `pyproject.toml` | `bun` (like `uv`, one fast all-in-one tool), `package.json`, `bun.lock` | Dependencies install per project into `node_modules`; no venv to activate. |
| `venv` | `node_modules/` folder | It lives inside the project automatically. |
| `python script.py` | `bun script.ts` (runs TS directly) or `node dist/script.js` (after `tsc`) | Shipped code is compiled first. |
| type hints + mypy | TypeScript types + `tsc` | TS is stricter and more central to the workflow. |
| Pydantic models | `zod` schemas + `z.infer` | Same idea: runtime validation. |
| FastAPI + uvicorn | Node's built-in `http`, or Express/Fastify; here we use `ws` and `net` | We use no HTTP framework. |
| `asyncio`, `async def` | `async`/`await` + Promises, event loop always running | No `asyncio.run()`; the loop is built in. |
| SQLAlchemy + Alembic | (none here) JSON files + `schemaVersion` | Prisma/Drizzle/Knex are the Node equivalents. |
| `pytest` | `bun test` (`describe` / `it` / `expect` from `bun:test`) | Different style, same purpose. |
| `subprocess.run([...])` | `child_process.execFile(cmd, [args])` | Always pass an argument array, never one shell string. |
| `os`, `pathlib` | `node:os`, `node:path`, `node:fs/promises` | Windows paths need care (`path.win32`). |
| `Depends()` / dependency injection | pass dependencies as function arguments (e.g. a fake clock in tests) | No framework magic. |
| settings / env vars | `process.env`, config JSON files | Same idea. |
| app startup/shutdown hooks | `process.on("SIGTERM")`, service stop events | The service wrapper triggers these. |
| GIL / threads | single thread + event loop | Worker threads exist but aren't needed. |

### 7.1 The lesson loop

Work one lesson at a time. Never dump more than one lesson. For each lesson:

1. **Goal and why.** One short paragraph: what we're building now and why the project needs it.
2. **Concepts.** Only what's needed for this lesson, in plain words, tied to what Bahir already knows (React, TypeScript basics, frontend tooling, and Python backend with FastAPI/SQLAlchemy/Alembic; see 7.0). Introduce Windows, Electron-main-process, service, and registry ideas from zero, since those are new to him.
3. **Steps, small.** For each step tell him:
   - **What to do:** create this folder or file at this exact path, add this to that file, or run this command.
   - **The code:** show it in small chunks (about 30 lines at most), and encourage him to **type it rather than paste**. Boilerplate configs may be pasted, but still explain each key.
   - **Why:** what each important line does, and what would go wrong without it.
   - For config files (`package.json`, `tsconfig.json`, `vite.config.ts`), explain **every option** the first time it appears.
4. **Pause.** After a lesson (or every 2–3 steps in a long lesson), stop and wait. He replies "done", pastes errors or output, or asks questions. Do not continue on your own.
5. **Review.** When he says done, Read the files he wrote. Give feedback in this order: things that are broken, then things that will break later, then TypeScript improvements, then style. Explain the reason for each. **Do not fix his files.** Tell him what to change and why; he applies it.
6. **Verify.** Give him the command to run (explained). He pastes the output. Say clearly for each lesson whether it **can be verified now** on any computer (for example `shared` unit tests) or **must wait for real Windows hardware**.
7. **Check understanding.** Ask 1–2 short "what would happen if…" questions. Answer his replies kindly and correct any misunderstanding.
8. **Commit.** Suggest one short commit message and the exact git commands (explained). He runs them.
9. **Update `PROGRESS.md`.**

Adapt the depth: if he says he already knows something, skip ahead. If he says "just show me the whole thing" for a step, do it (that counts as an explicit request), then explain it afterwards. If he's stuck, give a hint first and the full answer only if the hint isn't enough.

### 7.2 Teach TypeScript on purpose

TypeScript is the main thing Bahir wants to learn. Each lesson names the TypeScript ideas it uses, explains each **the first time it appears**, says **why TypeScript makes this code safer here**, and points out where he'd have made mistakes in plain JavaScript. Suggested progression:

| Lesson | He builds | TypeScript ideas to teach |
|---|---|---|
| 0 | Environment, how Bun and Node run TS | JS vs TS, Bun running `.ts` directly, `tsc` compiling to JS, Node's built-in type stripping and its limits, source maps |
| 1 | Repo, workspaces, tsconfig | `strict`, `target`, `module`, `moduleResolution`, `noUncheckedIndexedAccess`, `extends`, why each option exists |
| 2 | `shared`: protocol types | type vs interface, union and literal types, `as const`, discriminated unions, `unknown` vs `any`, zod schemas and `z.infer`, type guards and narrowing |
| 3 | `shared`: state machine | pure functions, reducers, exhaustive `switch` with `never`, `readonly`, tagged unions for states/events, first `bun test` tests |
| 4 | `shared`: crypto + pairing string | `Buffer` and typing binary data, generics, error handling with `Result`-style returns, branded types (e.g. `MachineId`) |
| 5 | `shared`: allow-list + policy builder | string/path handling, validation functions, mapped types, testing edge cases |
| 6 | Agent core | modules and imports, async/await typing, `Promise<T>`, interfaces for dependencies (fake clock), config schemas |
| 7 | Agent password, registry, CLI | `child_process.execFile` typing, dependency injection for dry-run, discriminated result types |
| 8 | Agent server link | `ws` typing, event emitters, reconnect logic, typing messages end to end |
| 9 | Agent shell IPC | `net` server, token auth, request/response typing |
| 10 | Enforcer, policies, shell switch | parsing external data safely, `readonly` arrays, audit vs enforce as a type |
| 11–12 | Kiosk shell | Electron main/preload/renderer typing, `contextBridge` typed APIs, React + TS (props, hooks, effects) |
| 13–14 | Manager server + UI | shared types across processes, IPC typing, forms and validation in React |
| 15–16 | Tools, docs, hardening | PowerShell explained line by line, threat model thinking |

### 7.3 Lesson plan (follows this order)

0a. **Environment** — install Bun, Node LTS, git, an editor, and plan a Windows VM (snapshots). Explain `bun -v` and `node -v`, what each tool is for (Bun: packages, scripts, tests; Node: runtime for the agent), and how both relate to TS. For the Bun install command, explain every part, including what a piped installer script does, and tell him to read the official install page first.
0b. **Node for Python developers** — done in a scratch folder **outside the repo**, before Lesson 1. Short exercises, each explained and each mapped to its Python equivalent: (1) write a tiny `.ts` file, run it directly with `bun`, then compile it with `tsc` and run the output with `node`, and compare; (2) read and write a JSON file with `node:fs/promises`; (3) a tiny TCP server and client with `node:net` (the same mechanism the shell↔agent link uses); (4) validate a message with `zod` (his Pydantic); (5) run another program with `execFile`; (6) a timer that shows the event loop staying responsive, then one that blocks it. Ask the understanding questions after each. He may skip any exercise he already understands. Do not start Lesson 1 until he says he's comfortable.
1. **Repo skeleton** — `git init`, root `package.json` with workspaces, `tsconfig.base.json`, `.gitignore`, package folders.
2. **shared: types and protocol** (zod).
3. **shared: state machine + tests.**
4. **shared: crypto (scrypt, HMAC) + pairing string + tests.**
5. **shared: allow-list matching + browser policy builder + tests.**
6. **agent: config, atomic JSON, state runner + monotonic timer.**
7. **agent: password check + rate limit, registry wrapper (dry-run), CLI.**
8. **agent: server link (ws, TLS pinning, reconnect).**
9. **agent: shell IPC (loopback + token).**
10. **agent: enforcer, browser and lockdown policies, shell switch.**
11. **kiosk-shell: main process, hardening, preload.**
12. **kiosk-shell: locked page, launcher, hotkey, password panel.**
13. **manager: server (cert, listener, storage, pairing, password).**
14. **manager: UI (machines, unlock dialog, allow-list editor, tray).**
15. **tools: PowerShell scripts, WinSW XML, firewall script, emergency restore, WDAC audit notes** (Bahir writes them; you explain every line).
16. **Docs and hardening:** `ARCHITECTURE`, `DECISIONS`, `SECURITY`, `RECOVERY`, `SETUP`, `TESTING`, per-package READMEs. Bahir writes these himself; you give the outline and review them. Writing them is part of learning.

### 7.4 `PROGRESS.md` (the one file you maintain)

Claude Code doesn't remember past sessions, so this file is your memory. Keep it short and current:

- A table of lessons with status (`todo` / `in progress` / `done`) and whether each is verified (`verified on any PC`, `waiting for Windows`, `verified on Windows`).
- A "What Bahir learned" list (TypeScript ideas he's now used).
- A "Struggles / revisit" list.
- "Open questions" and "Decisions so far" (one line each).
- The `UNTESTED(windows)` spots collected so far, mirroring his `TESTING.md`.

At the start of every session, read `PROGRESS.md` and continue from where it stops.

---

## 8. Definition of done

- Every lesson is done and Bahir can explain, in his own words, what each package does and why.
- All unit tests in `shared` pass on his machine (he pasted the output).
- Every risky Windows spot has an `// UNTESTED(windows):` comment and appears in his `TESTING.md`. After the VM/hardware tests, `PROGRESS.md` shows which are verified.
- Both safety defaults (`dryRun: true`, `enforcement: audit`) are on out of the box.
- `RECOVERY.md` exists and covers: Shift at boot to reach the admin account, Safe Mode, and the exact command to reset the kiosk user's `Shell` back to `explorer.exe`, with every part of the command explained. `tools/scripts/emergency-restore.ps1` does the same.
- Nothing was installed by you and no project code was run by you.

---

## 9. Things you must not do

- Do not write his project files for him (unless explicitly asked for a specific one).
- Do not skip the "why", and do not show a command without explaining its parts.
- Do not add features beyond this file (no telemetry, no cloud, no auto-update, no remote desktop, no per-PC policy overrides in v1).
- Do not hard-code passwords, IPs, or real logos.
- Do not use any Windows Home-unsupported feature (Shell Launcher, Assigned Access, AppLocker, Group Policy editor, Intune).
- Do not weaken a safety default to make something "work".
- Do not tell Bahir something is verified when it is not.
