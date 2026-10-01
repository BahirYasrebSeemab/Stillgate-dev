# Real-hardware test checklist

Everything here is **UNTESTED(windows)** until it is ticked on a real Windows 11 Home PC.
Do it on **one** visitor PC first, with the admin account ready and `docs/RECOVERY.md` printed.
Grep the code for `UNTESTED(windows)` to see every risky spot.

Mark each line: `[ ]` not tested · `[x]` works · `[!]` broken (write what happened).

## A. Build on Windows
- [ ] `bun install`, `bun run build`, `bun run test` pass on Windows (same as on Linux)
- [ ] `bun x install-electron` in `packages/manager` and `packages/kiosk-shell`; `bun run start` opens each app
- [ ] `bun run dist` (electron-builder) works for manager (NSIS) and kiosk-shell (`dir`). If dependencies are missing: add `[install] linker = "hoisted"` to a root `bunfig.toml`
- [ ] `bun run bundle` in `packages/agent-service` → `release/agent/main.js` + `cli.js` run with `node`

## B. Manager PC
- [ ] Manager starts, creates the certificate, shows "Server running on port 47800"
- [ ] `safeStorage` works (no "OS encryption not available" error)
- [ ] Tray icon shows; closing the window keeps the server running; "Quit" stops it
- [ ] Starts with Windows after install (login item)
- [ ] `firewall-manager.ps1` creates the rule; another LAN device can NOT connect to 47800; visitor PCs can
- [ ] Windows firewall pop-up on first start: choose Cancel, then run the firewall script

## C. Visitor PC install (dry-run on, audit on)
- [ ] Kiosk user created as **standard** user; separate admin account exists
- [ ] `install-agent.ps1` succeeds; `C:\ProgramData\AsdLabLock` ACL = SYSTEM + Administrators; `shell\` also readable by kiosk user
- [ ] Service `asd-agent` runs as LocalSystem, restarts after `taskkill /F` on its node.exe
- [ ] `cli.js status` shows dry-run ON, audit, kiosk user set
- [ ] `agent.log` shows the planned `reg` commands (dry_run events) and nothing is actually changed
- [ ] Pairing with the manager works; the PC appears online; "synced"
- [ ] Unlock / extend / lock from the manager change the state; countdown is right
- [ ] Service restart while UNLOCKED keeps the remaining time (monotonic clock across restarts)
- [ ] PC reboot while UNLOCKED → comes back LOCKED
- [ ] Manager offline → PC stays in its state, never unlocks; reconnects when manager returns

## D. Turn dry-run OFF (keep audit) — snapshot/backup first
- [ ] `cli.js set-dry-run off`; Edge policies appear under `HKLM\SOFTWARE\Policies\Microsoft\Edge` (check `edge://policy`)
- [ ] Blocklist `*` + allow-list work; InPrivate, guest, new profile, devtools, downloads blocked
- [ ] Check whether blocking `edge://*` pages causes errors (Microsoft warns about it); decide on allow-listing any
- [ ] Kiosk user lockdown values are set (Task Manager, Lock, Change password, regedit, Sign out disabled) — VERIFY names on the Ctrl+Alt+Del screen
- [ ] Kiosk user's `Shell` = kiosk-shell.exe (per-user Winlogon value is honoured) — **the riskiest step**
- [ ] Auto sign-in (Sysinternals Autologon) + boot → kiosk shell appears, no desktop, no taskbar
- [ ] Kiosk window: can't close (Alt+F4), no reload/zoom/devtools shortcuts, stays on top while locked
- [ ] Kiosk shell reaches the agent via the token file (no "Service not running")
- [ ] Windows restart/shutdown is NOT blocked by the kiosk window (session-end handling)
- [ ] Launch an allowed app (icon shows); open an allowed site in Edge
- [ ] `reg load`/`reg unload` of the kiosk hive when the kiosk user is signed out

## E. Maintenance and recovery
- [ ] Hotkey: chord and sequence both open the panel (try a cheap keyboard; Russian layout active)
- [ ] Wrong password ×5 → lockout message; lockout doubles
- [ ] Right password → PC restarts into the normal desktop (Shell = explorer, read-back verified)
- [ ] Maintenance lasts 30 min, then shows the 60 s restart notice and returns to the kiosk shell
- [ ] "End maintenance" (rearm) from manager and from `cli.js rearm` work
- [ ] `emergency-restore.ps1` works from the admin account AND from Safe Mode
- [ ] `docs/RECOVERY.md` manual `reg` commands work
- [ ] Shift at boot reaches the login screen; Ctrl+Alt+Del → Switch user works (or document if not)

## F. Enforcer (audit first, at least a few days)
- [ ] Process listing works and how long it takes per cycle (CIM `GetOwner` for every process; must stay well under 2 s)
- [ ] `would_kill` log while LOCKED/UNLOCKED: review every entry; add needed system helpers / folders
- [ ] Edge helper processes and WebView2 (`msedgewebview2.exe`) behaviour with sites allowed / not allowed
- [ ] Kiosk shell's own helper processes are never on the list
- [ ] Then `cli.js set-enforcement enforce`: forbidden programs close within ~2 s; at expiry, apps close
- [ ] Only kiosk-user processes are ever touched (check admin/SYSTEM processes untouched)
- [ ] Deny-listed tool started via an 8.3 short path is still caught

## G. Later (optional)
- [ ] WDAC audit policy (tools/policies/README.md), one week of logs
