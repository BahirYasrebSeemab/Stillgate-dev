// Windows path handling written as plain string logic (no node:path),
// so the manager UI running in a browser sandbox can use it too.

const DRIVE_ROOT = /^[a-zA-Z]:\\/;
const LONG_PATH_PREFIX = "\\\\?\\";
const INVALID_SEGMENT_CHARS = /[<>:"|?*\x00-\x1f]/;

// Normalizes an absolute drive path the way Windows compares them:
// "C:/Program Files/../Apps/Foo.EXE" -> "c:\apps\foo.exe".
// Returns null for relative paths, UNC/network paths and invalid characters.
export function normalizeWinPath(input: string): string | null {
  let p = input.trim().replaceAll("/", "\\");
  if (p.startsWith(LONG_PATH_PREFIX)) p = p.slice(LONG_PATH_PREFIX.length);
  if (!DRIVE_ROOT.test(p)) return null;

  const drive = p.slice(0, 2).toLowerCase();
  const segments: string[] = [];
  for (const rawSegment of p.slice(3).split("\\")) {
    // Windows ignores trailing dots and spaces in names: "cmd.exe. " opens "cmd.exe"
    const segment = rawSegment.replace(/[. ]+$/, "");
    if (rawSegment === "" || rawSegment === ".") continue;
    if (rawSegment === "..") {
      segments.pop(); // like Windows, ".." at the drive root stays at the root
      continue;
    }
    if (segment === "" || INVALID_SEGMENT_CHARS.test(segment)) return null;
    segments.push(segment.toLowerCase());
  }
  return `${drive}\\${segments.join("\\")}`;
}

// True if `file` is inside `folder` (both already normalized).
// Checks a separator boundary: c:\apps\foobar is NOT inside c:\apps\foo.
export function isUnderFolder(file: string, folder: string): boolean {
  const prefix = folder.endsWith("\\") ? folder : `${folder}\\`;
  return file.startsWith(prefix);
}

export function isAbsoluteWinPath(input: string): boolean {
  return normalizeWinPath(input) !== null;
}

// Last segment of a normalized path: "c:\windows\system32\cmd.exe" -> "cmd.exe"
export function baseName(normalizedPath: string): string {
  const index = normalizedPath.lastIndexOf("\\");
  return index === -1 ? normalizedPath : normalizedPath.slice(index + 1);
}
