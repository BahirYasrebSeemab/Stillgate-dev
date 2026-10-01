import { describe, expect, it } from "bun:test";
import { findAllowedApp } from "./allowlist";
import { AppEntry } from "./policy";
import { baseName, isUnderFolder, normalizeWinPath } from "./win-path";

describe("normalizeWinPath", () => {
  it("lowercases and unifies slashes", () => {
    expect(normalizeWinPath("C:/Program Files/App/App.EXE")).toBe("c:\\program files\\app\\app.exe");
  });

  it("resolves . and .. segments", () => {
    expect(normalizeWinPath("C:\\Apps\\Foo\\..\\..\\Windows\\.\\System32\\cmd.exe")).toBe("c:\\windows\\system32\\cmd.exe");
  });

  it("stays at the drive root on too many ..", () => {
    expect(normalizeWinPath("C:\\..\\..\\Windows")).toBe("c:\\windows");
  });

  it("strips trailing dots and spaces like Windows does", () => {
    expect(normalizeWinPath("C:\\Windows\\System32\\cmd.exe. ")).toBe("c:\\windows\\system32\\cmd.exe");
  });

  it("removes the long-path prefix", () => {
    expect(normalizeWinPath("\\\\?\\C:\\Apps\\a.exe")).toBe("c:\\apps\\a.exe");
  });

  it("rejects relative, UNC and invalid paths", () => {
    expect(normalizeWinPath("notepad.exe")).toBeNull();
    expect(normalizeWinPath("\\\\server\\share\\a.exe")).toBeNull();
    expect(normalizeWinPath("C:\\Apps\\a|b.exe")).toBeNull();
    expect(normalizeWinPath("C:relative.exe")).toBeNull();
  });
});

describe("isUnderFolder", () => {
  it("requires a separator boundary", () => {
    expect(isUnderFolder("c:\\apps\\foo\\x.exe", "c:\\apps\\foo")).toBe(true);
    expect(isUnderFolder("c:\\apps\\foobar\\x.exe", "c:\\apps\\foo")).toBe(false);
    expect(isUnderFolder("c:\\apps\\foo", "c:\\apps\\foo")).toBe(false);
  });

  it("gives the file name with baseName", () => {
    expect(baseName("c:\\windows\\system32\\cmd.exe")).toBe("cmd.exe");
  });
});

describe("findAllowedApp", () => {
  const apps = [
    AppEntry.parse({ id: "notepad", name: "Notepad", exePath: "C:\\Windows\\System32\\notepad.exe" }),
    AppEntry.parse({
      id: "office",
      name: "Word",
      exePath: "C:\\Program Files\\Office\\WINWORD.EXE",
      folderPath: "C:\\Program Files\\Office",
    }),
  ];

  it("matches by full path, ignoring case", () => {
    expect(findAllowedApp("c:\\windows\\system32\\NOTEPAD.EXE", apps)?.name).toBe("Notepad");
  });

  it("does not match the same name in another folder", () => {
    expect(findAllowedApp("C:\\Users\\kiosk\\Downloads\\notepad.exe", apps)).toBeNull();
  });

  it("matches helpers inside an allowed folder but not look-alike folders", () => {
    expect(findAllowedApp("C:\\Program Files\\Office\\helper\\x.exe", apps)?.name).toBe("Word");
    expect(findAllowedApp("C:\\Program Files\\Office Evil\\x.exe", apps)).toBeNull();
  });

  it("is not fooled by .. tricks", () => {
    expect(findAllowedApp("C:\\Program Files\\Office\\..\\..\\Windows\\System32\\cmd.exe", apps)).toBeNull();
  });
});
