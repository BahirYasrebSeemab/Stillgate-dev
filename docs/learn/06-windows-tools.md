# Learn: the Windows tools (`tools/`)

> **In one sentence:** small PowerShell scripts and one XML file that install, protect and rescue the system on real Windows PCs. They're the only parts written in PowerShell, and **all of them are UNTESTED(windows)**.

## `service-wrapper/stillgate-agent.xml` (WinSW)
**Analogy:** WinSW is a translator between Windows' service manager and our Node program.
- `<executable>` = node.exe; `<arguments>` = `"%BASE%\main.js"` (`%BASE%` = the wrapper's folder).
- `<startmode>Automatic</startmode>`: start at boot, as **LocalSystem** (WinSW's default).
- `<onfailure action="restart" …>` three times + `<resetfailure>1 hour</resetfailure>`: crash → restart after 5 s, 10 s, 30 s.
- `<stoptimeout>`: on stop, WinSW sends **Ctrl+C**, which the agent handles as `SIGINT` and shuts down cleanly.

## `scripts/install-agent.ps1` (visitor PC, as Administrator)
1. Checks it runs as admin, that every file exists, and that the kiosk user is **not** an administrator.
2. Copies `main.js`/`cli.js`, the kiosk shell and WinSW into `C:\Program Files\Stillgate`; writes the XML with the real node.exe path.
3. Creates `C:\ProgramData\Stillgate` and sets permissions with **icacls**:
   - `/inheritance:r` removes inherited rights;
   - `/grant:r "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"` gives full control to **SYSTEM** and **Administrators** only;
   - `*S-1-…` is a **SID**, which works on Russian/Tajik Windows where group names are translated;
   - `(OI)(CI)` means "also files and subfolders";
   - the `shell\` subfolder also gets `RX` (read) for the kiosk user's SID, so the shell can read the token.
4. `stillgate-agent.exe install` + `start`, then `cli.js init` with the kiosk user's name, SID and shell path.
5. **It doesn't touch the shell or lockdown:** dry-run and audit stay on.

## `scripts/emergency-restore.ps1`
It works without the agent, the network or the manager:
1. stops the agent (otherwise it would switch the shell back);
2. finds the kiosk user's registry hive, using `reg load` if they're signed out;
3. sets `Shell = explorer.exe`;
4. removes the lockdown values and the Edge policies;
5. runs `reg unload` (after `[GC]::Collect()`, which releases file handles).

It's used by `uninstall-agent.ps1` and by `docs/RECOVERY.md`.

## `scripts/firewall-manager.ps1` (manager PC)
- One inbound rule: TCP 47800, **only from the visitor PCs' IPs**.
- It deletes the "allow this program" rules Windows creates from the first-run pop-up, because those allow **every** address.

## `policies/README.md` (App Control / WDAC)
Kernel-level "only these programs may run". **Audit only in v1:**
- build the policy on a Pro/Enterprise machine from Microsoft's `DefaultWindows_Audit.xml`;
- collect a week of audit logs;
- never enforce without a tested way back.

## PowerShell ↔ Python, quickly
| PowerShell | Python-ish |
|---|---|
| `param([string]$KioskUser = "kiosk")` | `def main(kiosk_user: str = "kiosk")` |
| `$ErrorActionPreference = "Stop"` | make every error raise (instead of printing and continuing) |
| `& reg.exe add ...` | `subprocess.run(["reg.exe", "add", ...])` (`&` = "call this program") |
| `$LASTEXITCODE` | `result.returncode` |
| `Get-LocalUser -Name kiosk` | look up a local account (returns an object with `.SID`) |
| `\| Out-Null` | throw the output away |
| `` ` `` at line end | line continuation (like `\` in Python) |
