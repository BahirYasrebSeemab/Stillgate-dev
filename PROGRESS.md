# PROGRESS — ASD Lab Lock

Maintained by Claude. Read at the start of every session, then `PLAN.md` / `docs/`.

> **MODE (since 2026-10-01, Bahir's explicit request): BUILD MODE.** Claude builds the project itself instead of coaching line by line (overrides CLAUDE.md §0 rules 1, 3, 4 for project-local tooling). Claude may run `bun install/add`, `tsc -b`, `bun test`, `bun build` inside the repo and commits one short commit per part under Bahir's git identity (no co-author/Claude lines, never push). Still: no system installs, no Windows commands, safety defaults stay on, every risky spot marked `UNTESTED(windows)`. Every part has a simple explanation in `docs/learn/` for Bahir to study afterwards.

## Status (2026-10-01)

| Part | Status | Verified |
|---|---|---|
| Repo skeleton, tooling | done | any PC: `bun run build`, `bun run typecheck` |
| `shared` (protocol, state machine, crypto, pairing, allow-list, Edge policy, Node helpers) | done | any PC: Bun tests |
| `agent-service` (config, runner, effects, registry, shell switch, lockdown, enforcer, server link, shell IPC, password, CLI, bundle) | done | any PC: Bun tests + Node TLS tests + dry-run smoke run; **Windows behaviour waiting for Windows** |
| `manager` (Electron: agent server, TLS cert, pairing, store, IPC, React UI, tray) | done | any PC: unit + **end-to-end** (real agent link ↔ real server, Node); **UI never launched yet** |
| `kiosk-shell` (Electron: agent client, launcher, hotkey, password panel, hardening) | done | any PC: hotkey tests + integration test with the real agent IPC server; **window never launched yet** |
| `tools/` (WinSW XML, install/uninstall/emergency/firewall PowerShell, WDAC notes) | done | **waiting for Windows** (not even syntax-checked: no PowerShell on this Linux box) |
| Docs (README, SETUP, TESTING, ARCHITECTURE, DECISIONS, SECURITY, RECOVERY, docs/learn/00–06) | done | — |
| Real-hardware testing (`TESTING.md` A–G) | **todo** | — |

Test totals at last run: **115 Bun tests + 11 Node tests, all passing**; `bun run typecheck` clean.

Commits: `feat: add shared protocol, state machine, crypto` → `feat: add agent service` → `feat: add manager app and server` → `feat: add kiosk shell` → `feat: add windows tools and docs`.

## Next steps
1. Bahir studies `docs/learn/` (start at `00-index.md`).
2. Move to Windows (PLAN.md Part 1), run `TESTING.md` section A (build + launch both Electron apps), then B → F on ONE visitor PC.
3. Fix whatever Windows testing finds; tick `TESTING.md`; mark verified spots here.
4. Optional later: Russian/Tajik strings, WDAC audit, `bun build --compile` single-exe agent.

## UNTESTED(windows) spots (mirror of TESTING.md; grep the code for `UNTESTED(windows)`)
- agent: registry wrapper, kiosk hive load/unload, shell switch + read-back, lockdown value names (VERIFY), power/shutdown.exe, process listing speed (CIM GetOwner), watcher kill, monotonic clock across service restarts, WinSW stop signal
- shared: atomic rename over existing file on Windows, Edge install path
- kiosk-shell: running as Winlogon Shell, launching programs/Edge, session-end close handling, token-file ACL
- manager: safeStorage/DPAPI, tray, login item, firewall pop-up, electron-builder packaging with Bun's isolated layout
- tools: every PowerShell script, WinSW XML

## What Bahir learned (coach-mode lessons before the switch)
- Bun/Node strip types, only tsc checks (≈ python vs mypy); tsc emits even on errors unless noEmitOnError.
- `unknown` + type guard (`value is T`) for JSON.parse output.
- Discriminated unions need distinct literal tags (the `ok: boolean` question).
- `private: true`, and why leaked keys must be rotated, not just deleted.
- Branded IDs and zod, as simple analogies.

## Notes about Bahir
- Prefers very short, simple ("like a 10-year-old") explanations before code.
- Config-key typos were silent when tools ignore unknown keys; recommended pasting configs, typing code.

## Decisions
See `docs/DECISIONS.md` (27 entries, supersedes PLAN.md D1–D20 where they differ).
Other: host PC is Windows 11 Home, too weak for a VM (test on a real spare PC instead). Project folder `~/projects/stillgate`.

## Side quest (2026-09-29): editor setup
nvim config rewritten (lua/yasreb/plugins/), tmux config at ~/.config/tmux/tmux.conf, backup in ~/config-backup-2026-09-29/. Still todo if Bahir wants: tmux phase 3 (TPM, vim-tmux-navigator, resurrect, sessionizer) and the cheat sheet.
