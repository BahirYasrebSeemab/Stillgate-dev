# PROGRESS — ASD Lab Lock

Maintained by Claude. Read at the start of every session.

> **MODE CHANGE (2026-10-01, Bahir's explicit request):** Claude now builds the whole project itself (overrides CLAUDE.md §0 rules 1, 3, 4 for project-local tooling): Claude may run `bun install/add`, `tsc -b`, `bun test` inside the repo, and commits one short commit per part under Bahir's git identity (no co-author/Claude lines, never push). Still no system installs, no Windows commands. Every part gets a learning doc in `docs/learn/` so Bahir can study it later.

## Lessons

| # | Lesson | Status | Verified |
|---|---|---|---|
| 0a | Environment (Bun, Node LTS, git, editor, VM plan) | done (tools preinstalled; VM → Phase C) | versions to record in SETUP.md |
| 0b | Node for Python developers (`~/learning/node-basics`) | skipped by Bahir after ex. 2 — teach net/zod/execFile/event-loop on first use in lessons 2, 7, 9 | — |
| 1 | Repo skeleton | done (SETUP.md skipped by Bahir — write during Windows move) | verified on any PC (tsc -b + node run) |
| 2 | shared: types and protocol | in progress (zod 4.6.5; steps 1–4 done; step 5 ids.ts given; typos MAX_UNLCOK_SEC/MAX_PLICY_ITEMS to fix) | — |
| 3 | shared: state machine + tests | todo | — |
| 4 | shared: crypto + pairing string + tests | todo | — |
| 5 | shared: allow-list + browser policy + tests | todo | — |
| 6 | agent: config, atomic JSON, state runner | todo | — |
| 7 | agent: password, registry wrapper, CLI | todo | — |
| 8 | agent: server link | todo | — |
| 9 | agent: shell IPC | todo | — |
| 10 | agent: enforcer, policies, shell switch | todo | — |
| 11 | kiosk-shell: main, hardening, preload | todo | — |
| 12 | kiosk-shell: screens, hotkey, password panel | todo | — |
| 13 | manager: server | todo | — |
| 14 | manager: UI | todo | — |
| 15 | tools: scripts, WinSW, firewall, WDAC notes | todo | — |
| 16 | docs and hardening | todo | — |

## What Bahir learned

- Bun/Node strip types, only tsc checks (≈ python vs mypy); tsc emits even on errors unless noEmitOnError.
- `unknown` + type guard (`value is T`) for JSON.parse output.
- Discriminated unions need distinct literal tags (understood via ok: boolean question).
- `private: true` and why leaked keys must be rotated, not just deleted.

## Struggles / revisit

- Prefers very short, simple ("like a 10-year-old") explanations before code.

- Typos in config keys (workspace, targate, reference, *.logs) — silent when the tool ignores unknown keys. Suggested pasting configs, typing code.
- Worked around a failing package import with a relative path instead of asking — reinforce: import packages by name, run `bun install` after adding packages.

## Open questions

- D13 plumbing additions (pair messages, `init` CLI) — Bahir to confirm.

## Side quest (2026-09-29)

- Bahir paused 0b to set up nvim + tmux first. nvim 0.12.5, tmux 3.4, Windows Terminal on WSL. Resume 0b ex. 2 afterwards.
- Done by Claude (Bahir asked): phase 1+2 rewrite of nvim config (split into lua/yasreb/plugins/), new ~/.config/tmux/tmux.conf. Backup in ~/config-backup-2026-09-29/. Waiting on Bahir: delete ~/.tmux.conf, install tree-sitter CLI, :Lazy sync, report. luarocks disabled in lazy; mason healthcheck timeout is harmless. Phase 3 (TPM, vim-tmux-navigator, resurrect, sessionizer) + phase 4 (cheat sheet) still todo.

## Decisions so far

- Verified: TS 7.0.2 supports `tsc -b` and CJS output; Bun `"bun"` export condition works; Bun 1.4 uses isolated linker (links in packages/<pkg>/node_modules); `bun add --filter` exists.
- D3 change: `verbatimModuleSyntax` dropped (conflicts with CJS output); `types` listed explicitly (TS 6 default). `composite` goes in each package tsconfig, not base.
- **Master plan lives in `PLAN.md`** — read it after this file every session.
- Phase A (lessons 0b–10) in WSL; move to native Windows at Lesson 11 (PLAN.md Part 1).
- Global decisions D1–D20 are in PLAN.md Part 2.
- Host PC is Windows 11 Home and too weak for a VM; VM/Phase C postponed, discuss much later.
- Staying on Opus for now (not switching to Sonnet yet).
- Project folder is `~/projects/stillgate` (target layout in CLAUDE.md calls it `asd-lab-lock/`).

## UNTESTED(windows) spots

- (none yet)
