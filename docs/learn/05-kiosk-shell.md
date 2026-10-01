# Learn: `packages/kiosk-shell`

> **In one sentence:** the kiosk shell is the only thing a visitor ever sees. It **replaces the Windows desktop** for the kiosk user and shows the locked page, the launcher, or the hotkey password box, but it has **no power of its own**.

**Analogy:** a TV remote with only the channels the parents allowed. The remote can ask for a channel by number (an **id**), but the cable box (the **agent**) decides whether that channel is allowed and what's actually on it.

---

## Who decides what
| Question | Who answers |
|---|---|
| Is the PC locked or unlocked? How much time is left? | the agent (pushes the state) |
| Which apps/sites are shown? | the agent (only while UNLOCKED) |
| Where is `paint.exe`? Which URL is "Khan Academy"? | the agent (from its own policy) |
| Is the restore password right? | the agent (hash + rate limit) |
| Actually starting the program | the kiosk **main process**, because it runs as the kiosk user |

If the agent can't be reached, the screen stays on the **locked page** with a small "Service not running" note. The launcher is **never** shown without the agent's say-so.

## Main process (`src/main/`)

| File | Job |
|---|---|
| `index.ts` | Starts the window and the `AgentClient`. While LOCKED it keeps the window **always on top**; while UNLOCKED it lets launched programs come to the front. It never quits. |
| `agent-client.ts` | Reads the **token file** (`ProgramData\AsdLabLock\shell\shell-token`; only the kiosk user can read it), connects to `127.0.0.1:<port>`, sends `subscribe`, receives state pushes, and **reconnects every 2 s forever**. Each request carries a `reqId`, so replies find their caller. TypeScript trick: a *distributive* `Omit` keeps each command's own fields. |
| `ipc.ts` | UI → main doors. Each one checks the input with zod, **asks the agent first**, and only then starts something. Icons come from `app.getFileIcon`, and only for apps the agent currently lists. |
| `launch.ts` | `spawn(path, [args])`, detached. Sites open in Edge: `msedge.exe <url>`. |
| `window.ts` | The kiosk window: full screen, frameless, `kiosk: true`, not closable, no navigation, no new windows. It blocks reload, DevTools, zoom and close shortcuts (F5, F12, Ctrl+R/W/±, Alt+F4), denies every permission request, and reloads itself if the page crashes. **Exception:** when Windows is restarting (`query-session-end` / `session-end`) it lets itself close, otherwise it would block the restart that maintenance needs. |

## Preload
Exposes `window.kiosk` with exactly `KioskApi`: `getView`, `onView`, `launchApp(id)`, `openSite(id)`, `appIcon(id)`, `restore(password)`.

## UI (`src/renderer/`)
- `App.tsx` picks the screen from the agent's state:

  | Agent state | Screen |
  |---|---|
  | unreachable | Locked + "service not running" |
  | LOCKED | Locked |
  | UNLOCKED | Launcher |
  | MAINTENANCE | "Restarting…" |

- `screens.tsx`:
  - **LockedScreen**: logo + "Please ask the registration desk to unlock this computer."
  - **Launcher**: app tiles (real program icons) and site tiles, a big countdown, and a **5-minute warning banner**.
  - **PasswordPanel**: the small box opened by the hotkey. It shows wrong-password, lockout ("try again in N seconds"), and no-password messages.
- `hotkey.ts` (**pure**, unit-tested): Space+B+Y+S.
  - **chord** = all four held together; **sequence** = in order within 3 s; the default accepts **either**, because cheap keyboards can't register 4 keys at once ("ghosting").
  - Uses `KeyboardEvent.code` (the **physical** key), so it works on Russian/Tajik layouts, where `event.key` would be `и` instead of `b`.
  - Ignores auto-repeat, and forgets held keys when the window loses focus.
- `api.ts`: `useKioskView` (state + pushes), `useNow` (1 s tick for the countdown), `useHotkey`. It blocks Space from "clicking" a focused tile, except in the password box, where you may type a space.
- `strings.ts`: all visitor-facing text, ready for translation.
- `assets/logo.svg` is a **placeholder**. Replace it with the real ASD logo.

**Known limit (in SECURITY.md):** the hotkey only works while the kiosk window has focus, not while a visitor is inside another program.

## Tests
- `hotkey.test.ts`: chord, sequence, too slow, wrong order, recovering after a wrong key, auto-repeat, chord-only mode.
- `agent-client.test.ts`: an **integration test**. The kiosk's real `AgentClient` against the agent's real `ShellIpcServer` with a real token file: subscribe, pushes, launch spec from the agent, lockout passthrough, and "no agent → null state".

## Not yet run for real
The Electron windows themselves haven't been opened yet: they're built and type-checked, but not launched. That's the first step on Windows (see `TESTING.md`). Don't run the kiosk shell on your everyday desktop: it's a full-screen, always-on-top window that refuses to close. Use the Windows test PC, or set `ASD_DEV_SERVER_URL` and expect to end it from Task Manager.
