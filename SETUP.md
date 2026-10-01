# Setup

## Development machine (what was used to build this)
| Tool | Version | Used for |
|---|---|---|
| Node.js | 24.19.0 (LTS) | runs the agent; the production runtime |
| Bun | 1.4.0 | install packages, run scripts and tests, bundle the agent |
| TypeScript | 7.0.2 (`bun.lock`) | compiler (the Go version) |
| Electron | 44.5.1 | manager + kiosk shell |
| Developed in | WSL2 (Ubuntu) on Windows 11 Home | move to native Windows for Electron/packaging (see `PLAN.md` Part 1) |

## Everyday commands (repo root)
| Command | What it does |
|---|---|
| `bun install` | installs every package's dependencies and links the workspace packages |
| `bun run build` | `tsc -b` (shared → agent → manager → kiosk-shell, in order) + Vite builds of both UIs |
| `bun run test` | Bun tests, then Node-runner tests (TLS + end-to-end) |
| `bun run typecheck` | build + type-check tests and both UIs |

## Building for the real PCs (on Windows)
1. `bun install && bun run build`
2. Agent: `cd packages/agent-service && bun run bundle` → `release/agent/main.js`, `cli.js`
3. Kiosk shell: `cd packages/kiosk-shell && bun x install-electron && bun run dist` → `release/win-unpacked/`
4. Manager: `cd packages/manager && bun x install-electron && bun run dist` → installer in `release/`
5. Download **WinSW-x64.exe** yourself from https://github.com/winsw/winsw/releases

## Installing
**Manager PC**
1. Run the manager installer. Start the app. If Windows shows a firewall pop-up, choose **Cancel**.
2. Set the **restore password** (tab "Restore password").
3. Give each visitor PC a fixed IP (DHCP reservation in the router), then as Administrator:
   `powershell -ExecutionPolicy Bypass -File tools\scripts\firewall-manager.ps1 -VisitorIPs <ip1>,<ip2>,<ip3>,<ip4>`

**Each visitor PC** (try ONE first; follow `TESTING.md`)
1. Create the **kiosk** user (standard user) and keep a separate **administrator** account.
2. Install Node.js LTS.
3. As Administrator:
   `powershell -ExecutionPolicy Bypass -File tools\scripts\install-agent.ps1 -KioskUser kiosk -AgentSource <...\release\agent> -KioskShellSource <...\release\win-unpacked> -WinSWExe <...\WinSW-x64.exe>`
4. In the manager: "Add a computer" → choose this PC's address → copy the pairing string. On the visitor PC:
   `& "C:\Program Files\nodejs\node.exe" "C:\Program Files\AsdLabLock\agent\cli.js" pair "<pairing string>"`
5. Check that `C:\Program Files\AsdLabLock\tools\emergency-restore.ps1` exists (the install script copies it; `docs/RECOVERY.md` uses it).
6. Set up automatic sign-in for the kiosk user with **Sysinternals Autologon** (download it yourself; never store the password in this repo).
7. Work through `TESTING.md` sections C → F. Turn off dry-run (`cli.js set-dry-run off`) and later switch to enforce (`cli.js set-enforcement enforce`) **only** when the checklist says so.
