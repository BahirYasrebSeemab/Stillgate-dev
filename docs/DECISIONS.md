# Decisions (and why)

D1–D20 were made in `PLAN.md` (Part 2). This file is the up-to-date list, including what changed while building.

| # | Decision | Why |
|---|---|---|
| 1 | Bun = package manager, script runner, test runner. **Node runs the agent** in production; Electron uses its own runtime. | TLS pinning and Windows-service behaviour are safer on the well-tested runtime. (Proved right: Bun's TLS client behaves differently with self-signed certs; see #15.) |
| 2 | All Node-side output is **CommonJS** (no `"type":"module"`), `module`/`moduleResolution` = `NodeNext`. | Electron's sandboxed preload must be CJS; one module system everywhere. |
| 3 | `verbatimModuleSyntax` **not** used. | It conflicts with CJS output (it would force `import x = require()`). |
| 4 | TS project references + `tsc -b`; each package has `composite: true`. | Builds in dependency order, and only rebuilds what changed. |
| 5 | `@asd/shared` exports: `"bun"` → TS source, `"types"` → `.d.ts`, `"default"` → JS. Subpath `@asd/shared/node` for Node-only code. | Bun tests need no build; the browser-side UIs never pull in `node:crypto`. |
| 6 | TypeScript **7** (the Go rewrite) is used. | It was the current version at install time; `tsc -b` and CJS output were both checked. |
| 7 | zod 4, every object schema **strict**. | Unknown keys are rejected: "reject unknown messages". |
| 8 | Expected failures return `Result<T,E>`; `throw` is for bugs only. | Failure becomes part of the type, so callers must handle it. |
| 9 | **App entries always have `exePath`**; `folderPath` is an optional *extra* allowance. (CLAUDE.md said "exePath \| folderPath".) | A folder alone can't be launched. |
| 10 | The **kiosk shell launches programs**, after the agent approves the id and returns the path. | A SYSTEM service can't start a program *as the kiosk user* without native code (forbidden). The enforcer is the real guard. |
| 11 | Shell ↔ agent = raw TCP, newline-delimited JSON, on 127.0.0.1. HTTP-looking input is dropped. | Browsers can't speak raw TCP, so web pages can't reach the agent (covers the "reject Origin header" rule). |
| 12 | Added protocol messages `pair_request` / `pair_result`, `auth_ok`, `error`; CLI `init` and `set-dry-run`. | Plumbing needed by the existing requirements (pairing, setup, turning dry-run off). |
| 13 | Boot marker = `Date.now() − uptime`, same boot if within ±120 s. | A clock change looks like a new boot, so the PC starts LOCKED: the safe direction. |
| 14 | **Certificate pinning by fingerprint, CA system off** (`rejectUnauthorized: false` + SHA-256 check on the `upgrade` event, before `open`). | Works with a self-signed cert, never "expires" for the agent, and no message reaches a wrong server (tested). |
| 15 | TLS tests run on **Node's** test runner (`*.nodetest.ts`, `bun run test:node`). | Bun's TLS client failed the handshake with self-signed certs; production is Node, so tests must be too. |
| 16 | The manager's TLS cert is self-signed, RSA-2048, SHA-256, **valid 20 years**. | Agents pin it; a normal 1-year cert would cut all PCs off after a year. |
| 17 | Admin CLI → running service via **request files** in `control\` (polled every 1 s). | Only admins can write there (ACL); works even if the service is stopped (handled at the next start). No extra listener. |
| 18 | Message size limit 1 MiB (manager ↔ agent, agent → shell push); shell requests 16 KiB. | A full policy (100 apps with paths and args) can exceed 64 KiB. |
| 19 | Windows paths are normalized with **plain string logic** (not `node:path`). | The manager UI (browser sandbox) validates paths with the same code. Windows also strips trailing dots/spaces, so we do too. |
| 20 | The hotkey uses `KeyboardEvent.code` (physical key); chord **or** sequence (3 s). | Russian/Tajik layouts change `.key`; cheap keyboards can't register 4 keys at once. |
| 21 | **Electron 44 needs no `trustedDependencies`.** It no longer downloads in an install script; run `bun x install-electron` once. | Verified in its `package.json`/`install.js`; CLAUDE.md predates this change. |
| 22 | The agent is deployed as a **bundle** (`bun run bundle` → `main.js` + `cli.js`, run by Node). | Bun's isolated `node_modules` uses symlinks that copy badly; two self-contained files are easy to install. `tsc` still type-checks and builds everything. |
| 23 | PowerShell scripts use **SIDs** (`*S-1-5-18`, `*S-1-5-32-544`) instead of group names. | Group names are translated on Russian/Tajik Windows. |
| 24 | In **dry-run**, shell-switch read-back is skipped and treated as success, and the kiosk hive isn't mounted. | Writes are only logged in dry-run, so a read-back could never match. |
| 25 | **A restart only happens after a verified shell change** in the same batch of effects. | Restarting with a broken `Shell` value could leave the PC unusable. |
| 26 | The kiosk window allows closing **only** when Windows ends the session (`query-session-end` / `session-end`). | Otherwise it would block the restart that maintenance depends on. |
| 27 | No policy XML for WDAC in the repo; audit-only instructions instead. | A wrong enforced policy can make a PC unbootable; build it from Microsoft's template on real hardware. |
| 28 | Process listing = **one long-running PowerShell** (started once), owners from `Get-Process -IncludeUserName`, paths from **one** CIM query, output forced to **UTF-8**. | Measured on Windows: CIM `GetOwner` per process = 16 s; reading `Get-Process .Path` = 2 s; PowerShell start-up = 0.9 s. Now ~0.27 s. Without UTF-8, Cyrillic names became `???`. |
| 29 | Development-only switches, ignored when installed: `ASD_KIOSK_WINDOWED=1` (normal window), `ASD_SERVER_HOST` (manager binds 127.0.0.1), `ASD_DEV_CAPTURE_DIR` (each app saves a picture + the text of its **own window**, never the screen). | Lets the apps be tested on a developer PC without taking it over, the firewall pop-up, or screenshots of private screens. |
| 30 | Pairing strings tolerate surrounding quotes/spaces. | Real Windows shells passed the quotes through as part of the text. |
| 31 | Bun test timeout 20 s (`bunfig.toml`). | The real-scrypt tests once exceeded Bun's 5 s default on a busy machine. |
| 32 | Kiosk user names must be English letters/digits (`[A-Za-z0-9._ -]`). | `reg.exe` output uses the OEM code page; non-ASCII names and paths could be misread. `check-pc.ps1` warns. |
| 33 | Kiosk = **Windows 8 Start screen** style: navy background, flat square tiles (apps square, sites wide), groups side by side, horizontal scrolling (mouse wheel scrolls sideways), fly-in animation; locked page has slow burgundy/blue wave lines. Manager: no rounded corners. | Bahir's design choice (2026-10-03). |
| 34 | Website tile icons: the kiosk **main process** reads the site's `<link rel=icon>` tags, downloads (public addresses only, 20 s, 256 KB), decodes `.ico` itself (PNG or bitmap entries), re-encodes to PNG, caches on disk. | Tested on real sites: `/favicon.ico` often 403/404; Electron can't decode `.ico`; `net.fetch` breaks with abort signals; the network is slow. |
| 35 | Electron **fuses** + refuse debugger switches in installed builds. | Security review: otherwise the always-allowed kiosk folder could run arbitrary code. |
| 36 | No remote "kill switch". | A remote way to disable deployed systems is a backdoor and a risk in itself; the system is LAN-only by design. |
