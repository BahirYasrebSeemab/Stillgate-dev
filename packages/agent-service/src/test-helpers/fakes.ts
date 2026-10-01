import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Clock } from "../deps";
import { resolveAgentPaths, type AgentPaths } from "../paths";
import type { Exec, ExecResult, RunOptions, WindowsTool } from "../windows/exec";

export type Call = { readonly tool: WindowsTool; readonly args: readonly string[]; readonly options: RunOptions };

// Records every command and answers with a canned result
export class FakeExec implements Exec {
  readonly calls: Call[] = [];
  constructor(private readonly answer: (call: Call) => ExecResult = () => ({ code: 0, stdout: "", stderr: "" })) {}

  async run(tool: WindowsTool, args: readonly string[], options: RunOptions): Promise<ExecResult> {
    const call = { tool, args, options };
    this.calls.push(call);
    return this.answer(call);
  }
}

export class FakeClock implements Clock {
  constructor(
    public mono = 1_000_000,
    public wall = 1_700_000_000_000,
    public boot = 1_699_999_000_000,
  ) {}
  monoMs(): number {
    return this.mono;
  }
  wallMs(): number {
    return this.wall;
  }
  bootWallMs(): number {
    return this.boot;
  }
  advance(ms: number): void {
    this.mono += ms;
    this.wall += ms;
  }
}

export async function tempPaths(): Promise<{ paths: AgentPaths; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "asd-agent-"));
  return {
    paths: resolveAgentPaths({ ASD_DATA_DIR: dir }),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

export const MACHINE_ID = "3f2b8c1e-5d4a-4b6c-9e8f-0a1b2c3d4e5f";
export const KIOSK = { user: "kiosk", sid: "S-1-5-21-1-2-3-1001", shellExe: "C:\\Program Files\\AsdLabLock\\kiosk-shell\\kiosk-shell.exe" };
