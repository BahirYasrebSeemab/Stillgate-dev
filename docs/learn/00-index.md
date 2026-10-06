# Learn Stillgate: start here

This folder explains **every part of the project in simple words**, written for Bahir to study after the build. Read the files in order; each one starts with a one-sentence summary and an analogy.

| # | File | You learn |
|---|---|---|
| 01 | [01-repo-and-tooling.md](01-repo-and-tooling.md) | How the repo is organised: Bun workspaces, tsconfig, build, tests |
| 02 | [02-shared.md](02-shared.md) | The rule book: messages, state machine, passwords, allow-lists |
| 03 | [03-agent-service.md](03-agent-service.md) | The guard on each PC: service, registry, enforcer, server link |
| 04 | [04-manager.md](04-manager.md) | The desk app: Electron, server, IPC, React UI |
| 05 | [05-kiosk-shell.md](05-kiosk-shell.md) | The visitor screen: launcher, hotkey, password panel |
| 06 | [06-windows-tools.md](06-windows-tools.md) | PowerShell scripts, WinSW, firewall, recovery, WDAC |

Then read the big-picture docs: [ARCHITECTURE](../ARCHITECTURE.md) → [DECISIONS](../DECISIONS.md) → [SECURITY](../SECURITY.md) → [RECOVERY](../RECOVERY.md).

## A good way to study
1. Read one learn file.
2. Open the code it talks about, side by side (in nvim: `<leader>pf` to find files, `gd` to jump to definitions, `K` for types).
3. Run that package's tests (`bun test packages/<name>`), break something on purpose, and watch a test fail.
4. Explain it back in your own words (to Claude, or in a note).

## TypeScript ideas, and where to see them
| Idea | Best example |
|---|---|
| literal types, `as const` | `shared/src/constants.ts`, `browser-policy.ts` |
| discriminated unions + narrowing | `shared/src/result.ts`, `protocol.ts`, `state-machine.ts` |
| exhaustive `switch` with `never` | `state-machine.ts` (`assertNever`), `agent-service/src/effects.ts` |
| generics | `Result<T,E>`, `JsonFileStore<S>`, `parseJsonMessage<S>` |
| branded types | `shared/src/ids.ts` (`MachineId`, `AppId`) |
| `unknown` + validation | every `parse…` function; `ipc.ts` in both Electron apps |
| zod + `z.infer` | `protocol.ts`, `policy.ts`, `agent-service/src/config.ts` |
| `readonly` / immutable updates | `config.update((c) => ({ ...c, … }))`, all view types |
| interfaces for dependencies | `agent-service/src/deps.ts`, `windows/exec.ts`, test fakes |
| typed EventEmitter | `StateRunner`, `ManagerService`, `AgentClient` |
| mapped / utility types | `Extract<…>`, `Exclude<…>`, distributive `Omit` in `kiosk-shell/src/main/agent-client.ts` |
| React + TS (props, hooks) | `manager/src/renderer/pages/*.tsx`, `kiosk-shell/src/renderer/*` |
| `contextBridge` typed APIs | `*/src/common/api.ts` + `*/src/preload/index.ts` |
