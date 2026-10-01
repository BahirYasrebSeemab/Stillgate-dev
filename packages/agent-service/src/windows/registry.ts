import type { Exec, ExecResult } from "./exec";

// A thin, typed wrapper over reg.exe. Every method builds an argument array.
// reg.exe flags used:  /v <name> = value name   /t <type> = value type
//                      /d <data> = value data   /f = don't ask "overwrite?"
// UNTESTED(windows): all real registry access.

export type RegResult = { readonly ok: boolean; readonly detail: string };

export class Registry {
  constructor(private readonly exec: Exec) {}

  async query(key: string, name: string): Promise<string | null> {
    const result = await this.exec.run("reg", ["query", key, "/v", name], { mutates: false });
    return result.code === 0 ? parseRegValue(result.stdout, name) : null;
  }

  async keyExists(key: string): Promise<boolean> {
    return (await this.exec.run("reg", ["query", key], { mutates: false })).code === 0;
  }

  setString(key: string, name: string, data: string): Promise<RegResult> {
    return this.write(["add", key, "/v", name, "/t", "REG_SZ", "/d", data, "/f"]);
  }

  setDword(key: string, name: string, data: number): Promise<RegResult> {
    return this.write(["add", key, "/v", name, "/t", "REG_DWORD", "/d", String(data), "/f"]);
  }

  deleteValue(key: string, name: string): Promise<RegResult> {
    return this.write(["delete", key, "/v", name, "/f"]);
  }

  deleteKey(key: string): Promise<RegResult> {
    return this.write(["delete", key, "/f"]);
  }

  // Mount another user's registry file (NTUSER.DAT) under HKU\<mountName>
  load(mountKey: string, hiveFile: string): Promise<RegResult> {
    return this.write(["load", mountKey, hiveFile]);
  }

  unload(mountKey: string): Promise<RegResult> {
    return this.write(["unload", mountKey]);
  }

  private async write(args: readonly string[]): Promise<RegResult> {
    return toRegResult(await this.exec.run("reg", args, { mutates: true }));
  }
}

function toRegResult(result: ExecResult): RegResult {
  return { ok: result.code === 0, detail: (result.stderr || result.stdout).trim() };
}

// `reg query KEY /v Shell` prints lines like:
//     Shell    REG_SZ    C:\Program Files\AsdLabLock\kiosk-shell.exe
// The data may contain spaces, so only the name and type are split off.
export function parseRegValue(output: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const line = new RegExp(`^\\s+${escaped}\\s+REG_[A-Z_]+\\s+(.*)$`, "im").exec(output);
  return line?.[1]?.trimEnd() ?? null;
}
