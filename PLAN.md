# PLAN.md — ASD Lab Lock master plan

> **Update 2026-10-01:** at Bahir's request the whole project was then BUILT by Claude (see `PROGRESS.md`). This plan is kept as the original map; where the build differs, `docs/DECISIONS.md` is the source of truth, and `docs/learn/` explains what was built.

Written at Bahir's request, as the map for all future coaching sessions.
`CLAUDE.md` defines **what** we build and **how the coach teaches**. This file lists **the order, the file-by-file specs, the decisions already made, and the traps**.

> **For the coach (any model):** every session, read `CLAUDE.md`, then `PROGRESS.md`, then this file's section for the current lesson.
>
> - This plan gives **specs, signatures, and decisions, not finished code**. Bahir writes every line, and you show code in chunks of 30 lines or fewer (`CLAUDE.md` §7.1).
> - Keep names, paths, ports, and message types **exactly** as written here, so later lessons fit together.
> - If you disagree with something here, explain why, agree the change with Bahir, and log it in `PROGRESS.md` → "Decisions so far".
> - Items marked **VERIFY** must be checked in official docs before you teach them.

---

## Part 1 — Where we develop

| Phase | Where | Lessons | Why |
|---|---|---|---|
| **A** | WSL2, `~/projects/stillgate` | 0b – 10 | `shared` is pure TS. The agent runs with `dryRun: true` and injected dependencies, so its logic is testable on Linux; Windows calls are only logged. |
| **B** | Native Windows (the WSL host PC) | 11 – 16 | Electron kiosk windows, `electron-builder` Windows output, and PowerShell scripts only behave like the target on Windows. |
| **C** | Windows 11 **Home** VM with snapshots, then one real visitor PC | Hardware tests | Everything marked `UNTESTED(windows)`. |

**Moving A → B (start of Lesson 11):**
1. Commit everything in WSL.
2. Push to a **private** GitHub repo, then clone it on Windows. Never copy `node_modules`.
3. Run `bun install` and `bun test` on Windows. Results must match WSL.
4. `.gitattributes` (Lesson 1) handles line endings.
5. Don't edit the project from WSL through `/mnt/c`.

---

## Part 2 — Global decisions

| # | Decision | Why |
|---|---|---|
| D1 | Package names are `@asd/shared`, `@asd/agent-service`, `@asd/kiosk-shell`, `@asd/manager`. They are linked with `"@asd/shared": "workspace:*"`. | Scoped names can't collide with npm packages, and `workspace:*` means "use the local folder". |
| D2 | All compiled output is **CommonJS**. No `"type": "module"`. tsconfig uses `module` and `moduleResolution` = `NodeNext`. | Sandboxed Electron preload must be CommonJS, and Electron main is CommonJS per `CLAUDE.md`. One module system everywhere. |
| D3 | `tsconfig.base.json` sets: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, `isolatedModules`, `skipLibCheck`, `declaration`, `sourceMap`, `target: "ES2022"`. Every package uses `extends`. | Maximum safety, and every flag is a teaching moment. Consider `verbatimModuleSyntax`; **VERIFY** that it's comfortable with CJS output first. |
| D4 | TS project references: root `tsconfig.json` has `"files": []` plus `references`, and each package sets `composite: true`. The build command is `bun x tsc -b`. | `tsc -b` builds `shared` first, which is how real monorepos build. |
| D5 | `@asd/shared` `exports` map: condition `"bun"` → `./src/index.ts`, `"types"` → `./dist/index.d.ts`, `"default"` → `./dist/index.js`. Also a `"./node"` subpath for Node-only helpers. | Bun tests use TS source with no build step; Node and Electron use compiled JS. **VERIFY** the `"bun"` condition in the Bun docs. |
| D6 | Validation uses zod. Every object schema is `.strict()`. **VERIFY** the API of the zod major version that actually installs. | This covers "reject unknown messages" from `CLAUDE.md`. |
| D7 | Expected failures return `Result<T,E>` = `{ok:true,value} \| {ok:false,error}`. Throw only for programmer bugs. | The compiler forces callers to handle failure. |
| D8 | Ports: server **47800** (TLS WebSocket), shell↔agent loopback **47831**. Both configurable. | Fixed in `CLAUDE.md`. |
| D9 | Data dir is `%ProgramData%\AsdLabLock\`. In dev, the env var `ASD_DATA_DIR` overrides it (e.g. `./.dev-data`, gitignored). | Lets the agent run in WSL during Phase A. |
| D10 | Every JSON file has `schemaVersion: 1` and is written atomically: temp file → fsync → rename. | A tiny stand-in for Alembic, and a crash never leaves a half-written file. |
| D11 | Shell↔agent traffic is **newline-delimited JSON over raw TCP** on 127.0.0.1. There's no HTTP/WebSocket on that port. The socket is destroyed if the first line isn't valid JSON with the right token, or if a line looks like an HTTP request (`GET `, `POST `, contains `Origin:`). Max line length is 16 KiB. | Browsers can reach localhost over HTTP/WebSocket but can't speak raw TCP, so web pages can't talk to the agent. Satisfies the Origin rule. |
| D12 | The kiosk-shell **main process** (running as the kiosk user) launches apps. It asks the agent `launchApp(appId)`. The agent checks state is UNLOCKED and the id is in the policy, then returns `{exePath, args}`. Shell main spawns it with an argument array. `openSite(siteId)` works the same: the agent returns a URL, and shell main opens Edge with that URL as its argument. | A SYSTEM service can't start a process as another user without native code, which the project forbids. The enforcer remains the real guard. |
| D13 | Plumbing additions, flagged for Bahir to confirm: protocol messages `pair_request`/`pair_result`, and agent CLI `init --kiosk-user --kiosk-sid --shell-exe` (called by the install script). | Needed to implement pairing and config that `CLAUDE.md` already requires. These aren't new features. |
| D14 | Boot marker: `bootWallMs = Date.now() - os.uptime()*1000`. It's the same boot if within ±120 s. | A clock change looks like a new boot and gives LOCKED, which is the safe direction. |
| D15 | Named constants in `shared/src/constants.ts`: <br>• `durationSec` 60–43200 <br>• restore password ≥ 10 characters <br>• maintenance 1800 s <br>• WS `maxPayload` 64 KiB <br>• heartbeat 15 s; offline after 45 s <br>• reconnect backoff 1 s doubling to 60 s, ±20 % jitter <br>• failed auth: 10 per IP per 5 min → block 15 min <br>• restore lockout per `CLAUDE.md` <br>• event log max 5000 | No magic numbers. |
| D16 | scrypt parameters `{N: 2**15, r: 8, p: 1, keylen: 64}` with `maxmem` 64 MiB. | Node's default `maxmem` is too small for these parameters, and that makes a good trap to teach. **VERIFY** in the Node crypto docs. |
| D17 | The hotkey uses `KeyboardEvent.code` (`Space`, `KeyB`, `KeyY`, `KeyS`), not `.key`. | Russian/Tajik keyboard layouts change `.key`. `.code` is the physical key. |
| D18 | Pairing string is IPv4 only: `asd1:<ipv4>:<port>:<64 lowercase hex>:<code>`. The code is 8 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. | IPv6 contains colons. Document this limitation. |
| D19 | Logs are JSON lines, rotated at about 5 MB, 3 files kept. They never contain fields named password, secret, token, hash, or salt. | `CLAUDE.md` §6. |
| D20 | Commits: one line, ≤ 50 chars, lowercase, imperative. Never a Claude/co-author trailer. | Hard rule 6. |

---

## Part 3 — Target file tree

```
stillgate/
├── CLAUDE.md PLAN.md PROGRESS.md README.md SETUP.md TESTING.md
├── package.json tsconfig.base.json tsconfig.json bun.lock
├── .gitignore .gitattributes .editorconfig   (bunfig.toml only if needed)
├── docs/ ARCHITECTURE.md DECISIONS.md SECURITY.md RECOVERY.md
├── packages/
│   ├── shared/src/
│   │   index.ts constants.ts result.ts ids.ts policy.ts
│   │   protocol.ts shell-protocol.ts state-machine.ts crypto.ts pairing.ts
│   │   allowlist.ts site-pattern.ts browser-policy.ts
│   │   node/index.ts node/atomic-json.ts        (+ *.test.ts next to each)
│   ├── agent-service/src/
│   │   main.ts cli.ts log.ts deps.ts
│   │   config/{paths,schema,store}.ts   state/{runner,persist}.ts
│   │   password/{verify,rate-limit}.ts  windows/exec.ts  registry/reg.ts
│   │   shell-switch/switch.ts
│   │   enforcer/{processes,decide,watcher,edge-policy,lockdown}.ts
│   │   server-link/client.ts  shell-ipc/server.ts
│   ├── kiosk-shell/  vite.config.ts electron-builder.yml assets/logo.svg (placeholder)
│   │   src/main/{index,window,agent-client,launch,ipc}.ts  src/preload/index.ts
│   │   src/renderer/{index.html,main.tsx,App.tsx,strings.ts,hotkey.ts,hotkey.test.ts}
│   │   src/renderer/screens/{Locked,Launcher,PasswordPanel}.tsx  hooks/{useKioskState,useHotkey}.ts
│   └── manager/  vite.config.ts electron-builder.yml
│       src/main/{index,tray,ipc}.ts
│       src/main/server/{tls,listener,auth,pairing,sessions,rate-limit}.ts
│       src/main/store/{machines,policy,password,events,secure}.ts
│       src/preload/index.ts
│       src/renderer/{main.tsx,App.tsx,strings.ts} pages/ components/
└── tools/ scripts/ service-wrapper/ policies/
```

---

## Part 4 — Lessons

Every lesson runs the loop in `CLAUDE.md` §7.1: goal → concepts → small steps → pause → review → verify → questions → commit → update PROGRESS.md.

### 0a — Environment ✅
Node, Bun, git, and Python are already installed. In Lesson 1, record their versions in `SETUP.md`. Node must be ≥ 22 (**VERIFY** the current LTS). The VM is postponed to Phase C.

### 0b — Node for Python developers
Work in a scratch folder **outside** the repo (`~/scratch/node-basics`). For each exercise, show the Python equivalent.
1. **Run TS three ways.** `hello.ts` with `bun hello.ts`; `tsc hello.ts` then `node hello.js`; then Node's type stripping, showing its limits (enums, parameter properties).
2. **Files and JSON.** Read/write JSON with `node:fs/promises`. Explain why `JSON.parse` returns `any` and why we switch to `unknown` + narrowing.
3. **TCP.** A server and client with `node:net`. Teach that data arrives in chunks, so we need line framing (a preview of D11).
4. **zod.** Show it next to Pydantic: `safeParse`, `z.infer`.
5. **Running programs.** Use `execFile` with an argument array, and contrast it with building a shell string (injection risk).
6. **The event loop.** Ticks keep printing during `await`, and freeze during a busy loop.

No commit, since this happens in a scratch folder.

### 1 — Repo skeleton
**Files:** root `package.json`, `tsconfig.base.json`, `tsconfig.json`, `.gitignore`, `.gitattributes`, `.editorconfig`, `SETUP.md`, and `package.json` + `tsconfig.json` for `shared` and `agent-service`. Kiosk and manager wait until 11 and 13.

**Root `package.json`:**
- `private: true`, `workspaces: ["packages/*"]`
- scripts `build: tsc -b`, `test: bun test`
- devDeps `typescript`, `@types/bun`, `@types/node`

**`.gitignore`:** `node_modules/`, `dist/`, `out/`, `release/`, `.dev-data/`, `*.log`, `*.pem`, `*.key`, `*.pfx`, `*.tsbuildinfo`, `.env*`.

**`.gitattributes`:** `* text=auto eol=lf`; `*.ps1`, `*.cmd`, `*.bat` use `eol=crlf`; `*.png` and `*.exe` are `binary`.

**Also:**
- Include `PLAN.md` and `PROGRESS.md` in the first commit.
- Write every file by hand. Don't use `bun init` at the root.

**TS ideas:** every option in D3, plus `extends`, `composite`, `references`, `rootDir`/`outDir`.

**Verify:** any PC. **Commit:** `chore: set up monorepo skeleton`

### 2 — shared: types and protocol
**Files:** `constants.ts`, `result.ts`, `ids.ts`, `policy.ts`, `protocol.ts`, `shell-protocol.ts`, `index.ts`, and tests. Add zod to `shared` (**VERIFY** how `bun add` targets a workspace).

**`ids.ts`:** branded types, e.g. `type MachineId = string & { readonly __brand: "MachineId" }`. Same for `AppId` and `SiteId`.

**`policy.ts`:**
- `AppEntry {id, name, exePath?, folderPath?, args?, iconPath?}`, with exactly one of `exePath`/`folderPath` set.
- `SiteEntry {id, name, pattern}`
- `Policy {version, apps (max 100), sites (max 100)}`

**`protocol.ts`:** discriminated unions on `type`.
- **AgentToServer:**
  - `hello {machineId, agentVersion}`
  - `auth_response {mac}`
  - `state_report {machineId, state, remainingSec|null, agentVersion, enforcement, passwordVersion, policyVersion}`
  - `heartbeat {}`
  - `event {kind, detail ≤500, at}`
  - `pair_request {code, hostname}`
- **ServerToAgent:**
  - `auth_challenge {nonce}`
  - `auth_ok {}`
  - `unlock {durationSec}`, `lock {}`, `extend {durationSec}`, `rearm {}`
  - `policy {policy}`
  - `password_update {record}`
  - `power {action: restart|shutdown}`
  - `pair_result {machineId, secret, password, policy}`
  - `error {code, message}`
- **Parsers:** `parseAgentMessage` and `parseServerMessage` return a `Result`. They check the size limit, then run `JSON.parse` inside try, then `safeParse`.

**`shell-protocol.ts`:**
- **Requests** (union on `cmd`): `{token, reqId}` plus one of `getState`, `subscribe`, `launchApp{appId}`, `openSite{siteId}`, `restore{password}`.
- **Responses:** `{reqId, ok: true, data}` or `{reqId, ok: false, error, retryAfterSec?}`. Error is one of `unauthorized`, `bad_request`, `not_allowed`, `locked_out`, `wrong_password`, `internal`.
- **State push:** `{push: "state", state, remainingSec, apps[{id,name,iconPath?}], sites[{id,name}], serverOnline}`

**TS ideas:** type vs interface, literal unions, `as const`, discriminated unions and narrowing, `unknown` vs `any`, `z.infer`, `Result`.

**Tests:**
- valid messages parse
- unknown type, extra key, oversized message, out-of-range duration, bad hex, and non-JSON are all rejected

**Verify:** any PC. **Commit:** `feat: add shared protocol schemas`

### 3 — shared: state machine
**File:** `state-machine.ts`, a pure reducer. It never reads the clock itself.

```
Now       = { mono: number; wall: number }                         // ms
LockState = {kind:"LOCKED"} | {kind:"UNLOCKED"; deadlineMono} | {kind:"MAINTENANCE"; deadlineWall}
LockEvent = UNLOCK{durationSec} | LOCK | EXTEND{durationSec} | RESTORE_OK{maintenanceSec} | REARM | TICK
Effect    = SET_SHELL{target:"kiosk"|"explorer"} | RESTART{delaySec, message?}
          | APPLY_LOCKDOWN | REMOVE_LOCKDOWN | PERSIST | REPORT
reduce(state, event, now) → { state, effects: readonly Effect[] }
bootRule(saved | null, bootWallMs, now) → LockState
remainingSec(state, now) → number | null   (rounded up)
```

**Rules (one test each):**
- UNLOCK from LOCKED sets a deadline. UNLOCK while UNLOCKED **replaces** the deadline (counting from now).
- EXTEND adds time when UNLOCKED. It is a no-op when LOCKED.
- TICK past the deadline → LOCKED. LOCK → LOCKED.
- RESTORE_OK → MAINTENANCE, with effects: remove lockdown, shell explorer, persist, restart 0.
- MAINTENANCE + (TICK past the wall deadline, or REARM) → LOCKED, with effects: shell kiosk, apply lockdown, persist, restart 60 with a message.
- MAINTENANCE ignores UNLOCK, LOCK, and EXTEND.
- **Boot rule:** MAINTENANCE survives a reboot. UNLOCKED survives only in the same boot (D14) and only if its deadline hasn't passed. Everything else → LOCKED.

Use an exhaustive `switch` with `never`, then show the compiler error you get when you add a new event without handling it.

**TS ideas:** reducers (like React's `useReducer`), `readonly`, tagged unions, first `bun test`.

**Verify:** any PC. **Commit:** `feat: add lock state machine`

### 4 — shared: crypto + pairing
**`crypto.ts`:**
- `PasswordRecord {algo:"scrypt", salt, hash, params, version}` (salt and hash in base64).
- `hashPassword` and `verifyPassword`. Verify uses the **stored** params and `timingSafeEqual`.
- `authMac(secret, nonce, machineId)` = HMAC-SHA256 over nonce + machineId.
- `safeEqualHex` checks lengths first, because `timingSafeEqual` throws on unequal lengths.
- `randomHex`.

**`pairing.ts`:** `encodePairing` / `decodePairing`, validated per D18.

**Tests:**
- the right password verifies, the wrong one doesn't
- the same password gives different hashes (different salts)
- a tampered hash fails
- the MAC depends on machineId
- pairing round-trips; bad IP, port 0, bad fingerprint, and wrong prefix are rejected

**TS ideas:** `Buffer` (Python `bytes`), generics, `Promise<T>`, branded ids in real use.

**Verify:** any PC. **Commit:** `feat: add password hashing and pairing`

### 5 — shared: allow-list, site patterns, Edge policy, atomic JSON
**`allowlist.ts`:**
- `normalizeWinPath` uses `path.win32.resolve`, lowercases, strips the `\\?\` prefix and trailing separators, and rejects relative and UNC paths.
- `isUnderFolder` needs a **separator boundary**: `c:\apps\foobar` is NOT under `c:\apps\foo`.
- `isExeAllowed(path, apps)`

**Tests:** casing, `/` vs `\`, `..` escapes, look-alike folders. Document that 8.3 short names can't be resolved without the filesystem (put this in SECURITY.md).

**`site-pattern.ts`:**
- Accept `[https://][.]host[:port][/path]` where the host has ≥ 2 valid labels, or is an IPv4 address.
- Reject: `*` anywhere, an empty host, a single label, whitespace, non-http(s) schemes, and anything longer than 253 characters.

**`browser-policy.ts`:** `buildBrowserPolicy(sites)` returns `URLBlocklist: ["*"]`, `URLAllowlist`, plus the hardening listed in `CLAUDE.md` §4.1. **VERIFY every policy name and value** on Microsoft Learn's Edge policy reference before teaching.

**`node/atomic-json.ts`:** `readJson(file, schema)` returns a `Result` with error `missing|corrupt`; `writeJsonAtomic` implements D10.

**TS ideas:** mapped types, `satisfies`, readonly arrays.

**Verify:** any PC. **Commit:** `feat: add allow-list and edge policy builder`

### 6 — agent: config, persistence, state runner
**`deps.ts`:**
- `Clock {monoMs, wallMs, bootWallMs}`. The real monotonic clock is `process.hrtime.bigint()`.
- `Exec {run(file, args)}`
- Tests use fake implementations of both.

**`config/`:**
- Paths come from D9.
- The zod config schema has `schemaVersion`, `machineId?`, `server? {host, port, certPem, fingerprint}`, `secret?`, `password?`, `policy`, and `kiosk? {user, sid, shellExe}`.
- Safety defaults: `enforcement` defaults to **`audit`** and `dryRun` defaults to **true**. `shellIpcPort` is also in the config.

**`state/persist.ts`:** saves `{schemaVersion, state, bootWallMs, savedAtWall}`.

**`state/runner.ts`:** holds the current state. `dispatch` runs reduce and then the effects through an injected runner. A TICK fires every 1 s, and a typed EventEmitter announces changes (**VERIFY** the generic typing in `@types/node`).

**`log.ts`:** implements D19.

**Tests (fake clock):** an unlock expires; the state survives a reload in the same boot; a new boot gives LOCKED.

**TS ideas:** interfaces as dependencies (manual `Depends()`), `bigint`, classes vs closures.

**Verify:** any PC. **Commit:** `feat: add agent config and state runner`

### 7 — agent: password, exec, registry, CLI
**`password/rate-limit.ts`:** pure logic plus a clock, following the `CLAUDE.md` lockout rule.

**`password/verify.ts`:**
- rate limit → verify → log the attempt (never the password) → dispatch RESTORE_OK
- If there's no hash yet (never paired), restore is impossible; log that the admin account must be used.

**`windows/exec.ts`:**
- `execFile`, promisified, with `windowsHide` and a timeout.
- **Dry-run logs instead of executing.**
- Only the tools listed in `CLAUDE.md` §3 are allowed, called by absolute path under System32 (**VERIFY** the paths).

**`registry/reg.ts`:** `query`, `addString`, `addDword`, `deleteValue`, `deleteKey`, `load`, `unload`. Each one builds an argument array; explain every `reg.exe` flag. Tests check the argument arrays against a fake Exec.

**`cli.ts`:** hand-parsed `process.argv`. Commands `init` (D13), `pair` (finished in Lesson 8), `status`, `set-enforcement`, `rearm`. Clear messages and exit codes.

**UNTESTED(windows):** every real `reg.exe` call. **Verify:** logic on any PC. **Commit:** `feat: add password check, registry wrapper, cli`

### 8 — agent: server link + pairing
Add `ws` and `@types/ws`.

**Pairing (first contact):**
- Connect, and on the TLS handshake compare the peer certificate's SHA-256 fingerprint with the one in the pairing string.
- If they don't match, **disconnect before sending anything**.
- Send `pair_request`, save the `pair_result` and the server certificate.

**Normal connection:**
- Trust only the saved certificate.
- Check the fingerprint in `checkServerIdentity`. Skip the hostname check, since we connect by IP.
- **VERIFY** in the Node `tls` docs and the `ws` README.
- A test **must** show that a different certificate is rejected.

**Flow:**
- hello → challenge → response → auth_ok → state_report
- Then dispatch every ServerToAgent message exhaustively.
- `password_update` is applied only if its version is newer.
- `power` calls `shutdown.exe` through `exec.ts`.

**Timers and offline:** heartbeat and backoff as in D15. **While offline: no state change, never unlock.**

**Tests:** use a local test server with a generated certificate (`selfsigned`; **VERIFY** its current API). Cover auth OK, a bad MAC, a wrong certificate, and the backoff schedule.

**Verify:** any PC. **Commit:** `feat: add server link with cert pinning`

### 9 — agent: shell IPC
**Server:**
- `net` server on 127.0.0.1:47831.
- A random token is written atomically to the token file. Its ACL is set by the install script: UNTESTED(windows).
- NDJSON framing, with D11 rejections.
- Every request goes through zod, and the token is compared in constant time.

**Commands:**
- `getState` and `subscribe`: push on change, plus a resync every 30 s.
- `launchApp` and `openSite`: follow D12.
- `restore`: the Lesson 7 flow.

**Tests (real sockets on port 0):** a bad token closes the connection; HTTP-looking input closes; an oversized line closes; `launchApp` while LOCKED or with an unknown id → `not_allowed`.

**Verify:** any PC. **Commit:** `feat: add shell ipc server`

### 10 — agent: enforcer, policies, shell switch
Follow `CLAUDE.md` §5 exactly. Every Windows-facing part here is **UNTESTED(windows)**.

**`enforcer/processes.ts`:**
- A fixed PowerShell CIM query, parsed with zod.
- Pitfalls to teach:
  - single-item JSON output comes back as an object, not an array, so normalise
  - protected processes have a null path
  - owner lookups are slow, so measure them on real hardware

**`enforcer/decide.ts`:** **pure** and heavily unit-tested. It turns the process list, state, policy, and kiosk user into the list of processes to close. Use the rules and deny list from `CLAUDE.md` §5.
- The kiosk shell's own install folder is always allowed.
- Edge is allowed when the policy has sites.
- Bahir finalises the list only after reviewing a week of audit-mode logs on the VM.

**`enforcer/watcher.ts`:** a 2 s loop. In `audit` mode it only logs.

**`edge-policy.ts` and `lockdown.ts`:** write or remove the values from `CLAUDE.md` §5. **VERIFY** every value name on Microsoft Learn first.

**`shell-switch/switch.ts`:**
1. load the hive if needed
2. write `Shell`
3. **read it back and verify**
4. unload the hive
5. restart only if the readback matched; otherwise log loudly

**`main.ts`:** wires everything together and shuts down cleanly on SIGINT/SIGTERM.

**Verify:** `decide.ts` on any PC; everything else waits for Windows. **Commit:** `feat: add enforcer and shell switch`

### 11 — kiosk-shell: main, hardening, preload (Phase B, on Windows)
**Move to Windows first** (Part 1).
- Add `electron`, `vite`, `@vitejs/plugin-react`, `react`, `react-dom`, and their types.
- Add `electron` to `trustedDependencies`, and explain why Bun blocks install scripts by default.
- If `electron-builder` fails with Bun's layout, add the hoisted linker in `bunfig.toml` (**VERIFY** the key name).

**Main process:**
- Window options from `CLAUDE.md` §4.3 (kiosk, frameless, `contextIsolation`, `sandbox`, no node integration, CSP, navigation and new windows denied, zoom and reload blocked).
- `agent-client.ts`: NDJSON client that reads the token file and reconnects.
- `launch.ts`: D12.

**Preload:** a minimal typed `contextBridge` API that only passes ids and the password.

**Verify:** on Windows (`dryRun` agent running locally). **Commit:** `feat: add kiosk shell main process`

### 12 — kiosk-shell: screens
**Screens:** Locked, Launcher (countdown, 5-min warning), PasswordPanel (wrong password, lockout countdown), service-unavailable note. All text lives in `strings.ts`, and `assets/logo.svg` is a placeholder.

**Hotkey:**
- `hotkey.ts` is a **pure** detector accepting "all four held" or "in order within 3 s", with a configurable mode and `.code` matching (D17).
- It's unit-tested with `bun test`.
- `useHotkey` wraps it for React.

**TS ideas:** props typing, hooks, effects, typing the preload API on `window`.

**Verify:** the detector on any PC; the UI on Windows. **Commit:** `feat: add kiosk screens and hotkey`

### 13 — manager: server
**`tls.ts`:** first-run certificate via `selfsigned`. The key is encrypted with `safeStorage`, and the fingerprint is shown in the UI.

**Listener:**
- `https` + `ws` server on 47800, with `maxPayload` set.
- Challenge-response auth, plus a failed-auth rate limit per IP.
- Unauthenticated sockets time out after 10 s.

**Pairing:**
- One-time code, 10 min, single use.
- Requires a restore password to be set first.
- Assigns a GUID and secret, and replies with the password record and the policy.

**Stores** (atomic JSON): machines (secret encrypted with `safeStorage`), policy, password record + version, events (max 5000). Password changes are pushed to every PC; the UI shows synced/pending.

**Sessions:** online/offline tracking and command fan-out.

**Verify:** protocol tests can run on any PC, using the agent from Lesson 8 as the client. **Commit:** `feat: add manager server`

### 14 — manager: UI
- Machines table (live remaining time).
- Unlock dialog: 1 h, 2 h, or custom minutes. Lock, extend, restart, shut down, re-arm. Multi-select.
- Allow-list editor that reuses the `shared` validators and shows errors inline.
- Password page, pairing page (copy string), rename/revoke, events view.
- Tray icon: closing the window hides it, and the server keeps running. Login item.
- Everything goes over typed IPC. There's no HTTP server for the UI.

**Verify:** Windows. **Commit:** `feat: add manager ui`

### 15 — tools
Bahir writes these, and the coach explains every line:
- `install-agent.ps1`: creates folders, sets ACLs with `icacls`, runs agent `init`, installs the WinSW service.
- `uninstall-agent.ps1`
- `firewall-manager.ps1`: port 47800 only from the visitor IPs.
- `emergency-restore.ps1`: stop the service, then reset the kiosk user's `Shell` to `explorer.exe`.
- WinSW XML (restart on failure; **VERIFY** the element names in the WinSW docs).
- `tools/policies/`: WDAC **audit-only** notes and XML, built on a Pro machine.

All UNTESTED(windows). **Commit:** `feat: add install and recovery scripts`

### 16 — docs and hardening
Bahir writes these docs himself: ARCHITECTURE, DECISIONS (copy D1–D20 and add to it), SECURITY (including everything that is not protected, from `CLAUDE.md` §6, plus D18 and the 8.3 path limitation), RECOVERY, SETUP, TESTING, and per-package READMEs. The coach gives outlines and reviews them. **Commit:** `docs: add architecture, security, recovery`

---

## Part 5 — Phase C test order (VM first, always snapshot before each step)

1. Create a Win11 Home VM, a kiosk standard user, a separate admin account, and auto sign-in.
2. Install the agent with `dryRun: true` and `enforcement: audit`. Read the logs.
3. Pair it with the manager on the host PC. Test unlock, lock, extend, and timer expiry.
4. Turn off `dryRun` for the registry only. Test the shell switch and emergency restore **before** anything else.
5. Test the hotkey restore, then maintenance, then rearm.
6. Test Edge policies.
7. Run the enforcer in audit mode for a week. Review the logs, finalise the lists, then switch to `enforce`.
8. Then one real visitor PC. Mark each item verified in `TESTING.md` and `PROGRESS.md`.
