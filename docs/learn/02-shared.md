# Learn: `packages/shared`

> **In one sentence:** `shared` is the rule book that the manager, the agent, and the kiosk shell all read, so they can never disagree about what a message or a lock state looks like.

**Analogy:** three people play the same board game. If each one prints their own copy of the rules, sooner or later the copies differ and they argue. `shared` is the *one* printed rule book that everyone reads.

There are two entry points:

| Import | Contains | Can run in |
|---|---|---|
| `@stillgate/shared` | types, zod schemas, pure logic | anywhere: Node, Bun, **and** the browser-like Electron windows |
| `@stillgate/shared/node` | password hashing, files, logging | Node only (it uses `node:crypto` and `node:fs`) |

**Why two?** The manager's UI runs in a sandboxed browser window, and a browser has no `node:crypto`. If the main entry imported it, the UI would break. So everything Node-only lives behind the second door.

---

## File by file

### `constants.ts`: every limit has a name
Ports, durations, size limits, rate limits, password rules.
- The **unit is part of the name** (`_SEC`, `_MS`, `_BYTES`, `_CHARS`). Mixing up seconds and milliseconds is the classic timer bug: a 1-hour unlock that lasts 3.6 seconds.
- `12 * 60 * 60` instead of `43200`, so you can see at a glance that it means 12 hours.
- **TS idea:** a `const` number has a *literal type*. Hover over `PROTOCOL_VERSION` and you'll see `1`, not `number`.

### `result.ts`: errors you can't ignore
```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```
**Analogy:** a green box (`ok: true`) always holds a toy (`value`); a red box (`ok: false`) always holds a note (`error`). Read the label, and you know what's inside.
- **TS ideas:** generics (`<T, E>`, like Python's `TypeVar`), a **discriminated union** (the literal `true`/`false` label lets TS narrow the type), `never` (a type with no values, so `ok(5)` fits any `Result<number, …>`).
- **Why not `throw`?** A function's type never says what it throws. `Result` makes failure part of the return type, so callers *must* handle it.

### `errors.ts`
`errorMessage(e: unknown)`. In JS you can `throw` anything (even a number), so a `catch` receives `unknown`. This turns it into a string safely.

### `ids.ts`: branded IDs
```ts
export const MachineId = z.uuid().brand<"MachineId">();
export type MachineId = z.infer<typeof MachineId>;
```
**Analogy:** keys that all look the same get a coloured tag. The machine lock only accepts red-tagged keys.
- To TypeScript, plain strings are all the same, so `unlockMachine(appId)` would compile. With brands it's a compile error.
- **The only way to get a tagged ID is zod parsing**, so every `MachineId` is also *checked* to be a real GUID.
- **The same name twice** (value `MachineId` and type `MachineId`) is fine: TS keeps values and types in separate drawers.
- `Hex64`: 64 lowercase hex characters. Used for secrets, nonces and certificate fingerprints.

### `zod-util.ts`: from raw text to typed data
`parseJsonMessage(schema, raw, maxBytes)` does three checks in order:
1. **size** (refuse huge input before doing any work),
2. **JSON parse** (inside `try`),
3. **schema check**.

It returns a `Result`. `describeZodError` turns zod's error list into one short line.

### `win-path.ts`: Windows paths, done carefully
`normalizeWinPath("C:/Program Files/../Apps/Foo.EXE")` gives `c:\apps\foo.exe`.
- Written as **plain string logic**, not `node:path`, so the UI can use it too.
- Lowercases (Windows doesn't care about case), turns `/` into `\`, resolves `.` and `..`, and strips trailing dots and spaces. **Windows itself ignores those**, so `cmd.exe. ` would otherwise slip past a naive check.
- Rejects relative paths, network (UNC) paths, and invalid characters by returning `null`.
- `isUnderFolder` checks for a **separator boundary**: `c:\apps\foobar` is *not* inside `c:\apps\foo`.

### `site-pattern.ts`: which websites are allowed
Validates Edge's URL filter format `[scheme://][.]host[:port][/path]`. It's **stricter than Edge** on purpose:
- **no `*` at all**, no single-word hosts like `com`, and only `http`/`https`;
- no `javascript:`, `file:` or `data:`;
- it returns the pattern **normalized** (lowercase scheme and host).

### `policy.ts`: the allow-list
- `AppEntry`: `id`, `name`, `exePath` (what to start), optional `folderPath` (also allow helper programs inside this folder), `args`, `iconPath`.
- `SiteEntry`: `id`, `name`, `pattern`. The pattern is validated *and normalized* during parsing (zod `.transform`).
- `Policy`: version plus the apps and sites, at most 100 each, with **no duplicate ids** (`.superRefine`).
- **Small change from CLAUDE.md:** it said "exePath | folderPath". A folder alone can't be *launched*, so `exePath` is always required, and `folderPath` is an extra allowance.

### `allowlist.ts`
`findAllowedApp(exePath, apps)` matches by **full resolved path**, never by process name. `notepad.exe` in the Downloads folder is *not* the allowed Notepad.

### `browser-policy.ts`: Edge lockdown values
`buildBrowserPolicy(sites)` returns `URLBlocklist: ["*"]`, then `URLAllowlist: [your sites]`, plus hardening:

| Value | Meaning |
|---|---|
| `InPrivateModeAvailability = 1` | InPrivate disabled |
| `BrowserGuestModeEnabled = 0` | no guest profiles |
| `BrowserAddProfileEnabled = 0` | no new profiles |
| `DeveloperToolsAvailability = 2` | no developer tools |
| `DownloadRestrictions = 3` | block all downloads |
| `HideFirstRunExperience = 1` | no welcome wizard |
| `StartupBoostEnabled = 0`, `BackgroundModeEnabled = 0` | Edge doesn't keep running after it's closed |

All names and values were checked on Microsoft Learn. **TS ideas:** `as const` (keep exact literal values), `keyof typeof` (make a type from an object's keys).

### `protocol.ts`: manager ↔ agent messages
Each message is a zod schema; together they form a `discriminatedUnion("type", …)`.

**Agent → server:**
- `hello`, then `auth_response`
- `state_report`, `heartbeat`, `event`
- `pair_request`

**Server → agent:**
- `auth_challenge`, then `auth_ok`
- `unlock`, `lock`, `extend`, `rearm`
- `policy`, `password_update`, `power`
- `pair_result`, `error`

Other details:
- Every object is **strict** (unknown keys are rejected).
- `durationSec` must be a whole number between 60 and 43200.
- `PasswordRecord` holds only salt + hash + scrypt parameters, never the password.
- Raw text only becomes a message through `parseAgentMessage` / `parseServerMessage`.

### `shell-protocol.ts`: kiosk shell ↔ agent messages
One JSON object per line over `127.0.0.1`.

**Shell requests** (the shell sends **ids only, never paths**):
- `getState`, `subscribe`
- `launchApp(appId)`, `openSite(siteId)`
- `restore(password)`

**Agent answers** with one of three message types:
- `reply` (with a result),
- `error` (with a code such as `locked_out`),
- `push` (a new state).

**Limits:** requests are capped at 16 KiB; pushes at 1 MiB, because they carry the app list.

### `state-machine.ts`: the brain's rules (most important file)
**Analogy:** a traffic light that only changes when an event arrives, and never looks at a clock itself. Someone tells it the time.
```ts
reduce(state, event, now) → { state, effects }
```
- **Pure:** no `Date.now()`, no timers, no Windows. That makes every rule testable in milliseconds.
- **States:** `LOCKED`, `UNLOCKED(deadlineMono)`, `MAINTENANCE(deadlineWall)`.
- **Two clocks:**
  - `mono` is a monotonic clock that can't be moved by changing the PC's clock. It's used for unlock timers, so a visitor can't gain time.
  - `wall` is real time. It's used only for maintenance, which must survive a reboot.
- **Effects** are *instructions* for the agent (`SET_SHELL`, `RESTART`, `APPLY_LOCKDOWN`, …). The reducer never does them itself; this is the same idea as Redux and `useReducer`.
- **`bootRule`** decides the starting state after a (re)start:
  - `UNLOCKED` survives only a service restart **in the same boot**;
  - `MAINTENANCE` survives reboots;
  - everything else starts `LOCKED`, and the lockdown is re-applied every time ("self-healing").
- **TS idea: `assertNever`.** If someone adds a new state or event and forgets to handle it, the code **stops compiling**.

### `pairing.ts`
`sg1:<ip>:<port>:<fingerprint>:<code>` with `encodePairing` and `decodePairing`. It's IPv4 only, because IPv6 addresses contain `:` themselves.

### `password-rules.ts`
`checkNewPassword(pw, confirm)`: at least 10 characters, both copies match, no leading or trailing spaces. The manager UI and the manager server both use it.

### `node/crypto.ts` (Node only)
- `hashPassword` / `verifyPassword`:
  - **scrypt** with a random 16-byte salt;
  - the parameters are stored with the hash, so they can be raised later;
  - comparison is **constant-time** (`timingSafeEqual`).
  - **Trap:** N=2¹⁵, r=8 needs 32 MiB, which is exactly Node's default memory cap, so `maxmem` must be raised.
- `authMac(secret, nonce, machineId)`: HMAC-SHA256. It proves the agent knows the secret without sending it.
- `safeEqualHex`, `randomHex`, `generatePairingCode`, `certFingerprint`.

### `node/atomic-json.ts`
`writeJsonAtomic`: write to a temp file, flush it to disk (`fsync`), then `rename` it over the real file. A power cut can never leave half a file. `readJson` returns `missing` or `corrupt` as normal results, not crashes.

### `node/log.ts`
A JSON-lines logger with rotation (~5 MB × 3 files). **Any field whose name looks secret** (password, secret, token, hash, salt, private…) is written as `[redacted]`, including inside nested objects.

---

## Tests (`*.test.ts`, run with `bun test`)
62 tests cover:
- every state-machine rule and the boot rule;
- message validation (strictness, limits, non-JSON, oversized input);
- path tricks (`..`, casing, trailing dots, look-alike folders);
- site-pattern rejects;
- the pairing round-trip;
- password hashing, MAC, atomic files, and log redaction.

**Build note:** test files are **not compiled into `dist/`**. Each package has a `tsconfig.test.json` that type-checks them only. Two reasons:
- otherwise `bun test` finds the compiled copies too and runs everything twice;
- production code shouldn't see Bun's types. It runs on Node.

Commands:
- `bun test`: run all tests.
- `bun run typecheck`: build, plus type-check the tests.
