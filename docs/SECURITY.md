# Security

## What we protect against
| Threat | Protection |
|---|---|
| A visitor uses the PC without being unlocked | Boot goes straight to the kiosk shell as `Shell`; the launcher only appears when the agent says UNLOCKED; the enforcer closes everything not allowed (LOCKED = nothing allowed). |
| A visitor runs other programs while unlocked | The process watcher closes anything not on the allow-list (matched by **full path**, not name); deny-listed Windows tools (`cmd`, `powershell`, `regedit`, `taskmgr`, `explorer`, …) are closed even inside `C:\Windows`. Task Manager, regedit, Lock, Change password and Sign out are disabled for the kiosk user. |
| A visitor browses anywhere | Edge policy `URLBlocklist=*` + `URLAllowlist`; InPrivate, guest/new profiles, developer tools and downloads disabled. |
| A visitor extends their time by changing the clock | The unlock timer runs on the **monotonic** clock; a clock change at boot looks like a new boot → LOCKED. |
| Another device on the LAN pretends to be the manager | Agents **pin the manager's certificate fingerprint** at pairing and send nothing to a server with a different certificate. |
| Another device pretends to be a visitor PC | HMAC challenge-response with a per-PC secret that never crosses the network after pairing; 10 failures/5 min from an IP → ignored for 15 min. |
| Someone pairs a rogue PC | One-time pairing codes, valid 10 minutes, used once; pairing is only possible after a restore password is set. |
| A web page talks to the agent on 127.0.0.1 | Raw TCP with JSON lines + token; anything that looks like HTTP is dropped; the token file is readable only by the kiosk user, SYSTEM and Admins. |
| The kiosk shell is compromised | It has no privileges: it can only send ids and a password; the agent decides and returns paths from its own policy. |
| Someone reaches the manager UI over the network | There is no web server for the UI: it's an Electron window using IPC. The only network listener is the agent port, limited to the visitor PCs by the firewall script. |
| Password guessing at the hotkey panel | 5 tries → 60 s lockout, doubling to 15 min; attempts logged (never the password). |
| Secrets leaking | Restore password stored only as a salted **scrypt** hash; manager secrets and TLS key sealed with DPAPI (`safeStorage`); agent config readable only by SYSTEM + Admins; logs redact secret-looking fields; `.gitignore` covers keys, certs, data and logs. |
| Bad input crashing or confusing the system | Every network, IPC and file input is validated with **zod** (strict schemas, size limits); every child process uses an **argument array** (no shell). |

## What is NOT protected (be honest with management)
- **Physical access / BIOS:** anyone who can boot from a USB stick, open the case, or change BIOS settings can do anything. → Set a **BIOS/UEFI password** and lock the boot order to the internal disk.
- **Safe Mode / Windows Recovery:** these bypass the service and the custom shell. → BIOS password; keep the admin password secret.
- **Holding Shift at boot** can stop automatic sign-in and show the login screen. That's not a way in without a password, but it is a way around the kiosk *screen*.
- **Anyone with the administrator account** can undo everything (by design: that's the recovery path). → A strong admin password, known only to management.
- **Windows 11 Home has no BitLocker** (only "device encryption" on some hardware). A removed disk can be read elsewhere, including the agent's pairing secret. → BIOS password; consider device encryption if available.
- **Edge policies only gate top-level navigation.** They don't block sub-resources or JavaScript navigation inside an allowed page, and an allowed site can link to content embedded from elsewhere.
- **The hotkey only works while the kiosk window has focus**, not while a visitor is inside another program (v1 limitation; they can use it after the session ends).
- **The process watcher acts after a program starts** (every 2 s). A program can run briefly before it's closed. App Control (WDAC, `tools/policies/`) would block before start; it's audit-only in v1.
- **Path normalization can't resolve 8.3 short names** (`C:\PROGRA~1\…`) without touching the disk. A deny-listed tool started via a short name could be missed. Mitigated by the WDAC plan and by the deny list running on the resolved process path Windows reports. **VERIFY** on hardware.
- **Pairing strings are IPv4 only.**
- **The manager PC itself** is trusted: anyone using its Windows account can unlock PCs.
- Everything that touches Windows is **untested** until `TESTING.md` is done.

## Security review: 2026-10-03
Reviewed: manager server and IPC, agent (server link, shell IPC, password, registry/exec, enforcer, CLI, control files), kiosk shell (IPC, launching, site icons, window), both Electron setups, install scripts, dependencies.

### Fixed in this review
| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | Packaged Electron apps could be started as plain Node.js (`ELECTRON_RUN_AS_NODE`), with `NODE_OPTIONS`, or with `--inspect`/remote debugging. Because the agent always allows the kiosk-shell folder, that would have been a way to run code the enforcer never closes. | High | Electron **fuses** set in both `electron-builder.yml` (no run-as-node, no NODE_OPTIONS, no inspect, only load app.asar, asar integrity check); installed apps also refuse to start with any debugger switch (`hasDebugSwitch`). |
| 2 | Site icons: an allowed site's HTML chooses the icon address, so it could have made the kiosk send requests into the ASD network (routers, the manager PC). | Medium | Icons only from public addresses or the site's own host (`isAllowedIconUrl`, tested); downloads are size-limited and re-encoded by Electron. |
| 3 | The manager window had no "deny all permissions" rule. | Low | Added (the kiosk already had it). |
| 4 | Unlimited half-open connections to the manager server could tie up the manager PC. | Low | At most 32 connections that have not logged in yet; each still has 10 s to log in. |

### Checked and OK
- Every network, IPC, file and CLI input is validated with strict zod schemas and size limits; unknown messages are rejected.
- Agent login: HMAC challenge-response, constant-time compares, unknown machines also get a challenge, failures counted per IP.
- Certificate pinning by SHA-256 fingerprint, checked before the first message is sent (tested with a wrong certificate).
- Pairing codes: 8 characters from 31, valid 10 minutes, single use, plus the per-IP failure limit.
- Restore password: salted scrypt, stored parameters, constant-time compare, lockout doubling to 15 min, never logged.
- All Windows tools are called by absolute System32 path with argument arrays (no shell, no injection). Registry values come from validated data.
- Electron: `contextIsolation`, `sandbox`, no Node in pages, strict CSP (no network from pages), navigation and new windows blocked, IPC only from our own page, DevTools only in development.
- Logs redact secret-looking fields; no secrets in the repo (secret scan clean).
- Data folders: agent data is SYSTEM + Administrators only (kiosk user can read just the token folder); program files under `C:\Program Files` are read-only for users.

### Remaining risks (accepted, know about them)
- **Loopback trust:** the kiosk shell trusts whatever answers on 127.0.0.1:47831. A program already running as the kiosk user could start first and pretend to be the agent; it could only show a fake launcher and start programs with kiosk-user rights, which that program already had. In **enforce** mode the enforcer closes such programs.
- **Restore lockout can be triggered by a visitor** (5 wrong guesses → 60 s, doubling to 15 min). That's annoying for staff, but not a way in. The Shift-at-boot admin path and `RECOVERY.md` still work.
- **Site icons are downloaded from the internet** by the kiosk PC (once, then cached). Those websites see the request, and Chromium's image decoders process data from the internet inside the kiosk process (kiosk-user rights only).
- **The agent's pairing secret** sits in `C:\ProgramData\Stillgate\config.json`, readable by Administrators. Anyone with the admin account can impersonate that PC to the manager. (Admins can undo everything anyway.)
- **No code signing** of the `.exe` files: Windows SmartScreen may warn, and file integrity relies on the `Program Files` permissions.
- **Build-tool advisory:** `http-cache-semantics` (GHSA-ch52-4w7c-c8xp, "≤ 4.2.0", no fixed release yet) is used only by Electron/electron-builder download tools on the developer PC and is not shipped in the apps. Re-check with `bun audit` later.
- Everything in the "What is NOT protected" list above still applies (BIOS, Safe Mode, physical access, the admin account).
