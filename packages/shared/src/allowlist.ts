import type { AppEntry } from "./policy";
import { isUnderFolder, normalizeWinPath } from "./win-path";

// Finds the allow-list entry that permits this executable, by resolved absolute path.
// Never matches by process name alone ("notepad.exe" anywhere on disk is NOT allowed).
export function findAllowedApp(exePath: string, apps: readonly AppEntry[]): AppEntry | null {
  const target = normalizeWinPath(exePath);
  if (target === null) return null;

  for (const app of apps) {
    if (normalizeWinPath(app.exePath) === target) return app;
    const folder = app.folderPath === undefined ? null : normalizeWinPath(app.folderPath);
    if (folder !== null && isUnderFolder(target, folder)) return app;
  }
  return null;
}
