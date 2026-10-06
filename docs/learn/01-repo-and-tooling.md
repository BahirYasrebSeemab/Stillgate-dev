# Learn: the repo and its tooling

> **In one sentence:** one git repo holds four packages that are installed, built and tested together, like one `uv` workspace with four members.

## The layout
```
package.json          workspaces: ["packages/*"], scripts (build / test / typecheck)
bun.lock              exact versions of every dependency (committed, like uv.lock)
tsconfig.base.json    the strict TypeScript rules every package extends
tsconfig.json         "solution": lists the packages so `tsc -b` builds them in order
packages/shared       ─┐
packages/agent-service │ each has its own package.json + tsconfig.json
packages/manager       │ (+ tsconfig.renderer.json and vite.config.mts for the Electron UIs)
packages/kiosk-shell  ─┘
tools/                PowerShell scripts, WinSW config, WDAC notes
docs/                 architecture, decisions, security, recovery, learn/
```

## How packages find each other
- `"@stillgate/shared": "workspace:*"` in a package's dependencies means "use the folder in this repo".
- Bun 1.4 uses the **isolated linker**: each package gets its own `node_modules` with **only what it declared**. A package can't accidentally import something it forgot to list. That's why the agent, manager and kiosk shell each list `zod` themselves.
- `shared`'s `exports` map has three conditions: `"bun"` → TS source (tests need no build), `"types"` → `.d.ts`, `"default"` → compiled JS. The subpath `@stillgate/shared/node` holds the Node-only helpers.

## TypeScript settings (tsconfig.base.json)
| Option | What it does |
|---|---|
| `strict` | the full set of strict checks (like mypy `--strict`) |
| `noUncheckedIndexedAccess` | `arr[0]` is `T \| undefined` |
| `exactOptionalPropertyTypes` | `x?: T` means "may be missing", not "may be `undefined`" |
| `noImplicitOverride` | an overriding class method needs the `override` keyword |
| `noFallthroughCasesInSwitch` | a `case` can't silently run into the next one |
| `forceConsistentCasingInFileNames` | catches import-casing mistakes that only break on Linux |
| `lib: ["ES2023"]`, no DOM | `window`/`document` is a compile error in Node code |
| `module` / `moduleResolution: NodeNext` + no `"type":"module"` | CommonJS output (Electron's preload needs it) |
| `noEmitOnError` | no JS is written if there's a type error |
| `declaration` + `declarationMap` + `sourceMap` | other packages see the types; stack traces point at `.ts` lines |

**The renderer configs** (`tsconfig.renderer.json`) are different: DOM types, `jsx: react-jsx`, `moduleResolution: Bundler`, and `noEmit`, because Vite bundles the UI.

## Builds
- `bun run build` → `tsc -b` (shared, then agent, manager, kiosk-shell; only what changed is rebuilt) + `vite build` for both UIs.
- The agent for real PCs: `bun run bundle` in `packages/agent-service` → `main.js` + `cli.js`, which plain `node` runs with no `node_modules` needed.

## Tests: three kinds
| Kind | Files | Run by | Why |
|---|---|---|---|
| Bun tests | `*.test.ts` | `bun test` | fast; most logic |
| Node tests | `*.nodetest.ts` | `bun run test:node` (compiles to `dist-test/`, then `node --test`) | TLS/network code must be tested on the production runtime |
| type-check of tests | `tsconfig.test.json` per package | `bun run typecheck` | tests aren't compiled into `dist/`, so they're checked separately |

Test files are **excluded from the build**:
- otherwise `bun test` would also find the compiled copies in `dist/` and run everything twice;
- production code shouldn't see Bun's types.

## Commits
One per finished part, short (`feat: add agent service`), under Bahir's git identity.
