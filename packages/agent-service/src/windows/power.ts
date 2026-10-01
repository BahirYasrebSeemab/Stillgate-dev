import type { Logger } from "@asd/shared/node";
import type { Exec } from "./exec";

// shutdown.exe flags:  /r = restart   /s = shut down   /a = abort a pending shutdown
//                      /t <sec> = delay   /c "<text>" = message shown to the user (max 512 chars)
// UNTESTED(windows)

const MAX_MESSAGE_CHARS = 512;

export class Power {
  constructor(
    private readonly exec: Exec,
    private readonly log: Logger,
  ) {}

  async restart(delaySec: number, message?: string): Promise<boolean> {
    const args = ["/r", "/t", String(delaySec)];
    if (message !== undefined) args.push("/c", message.slice(0, MAX_MESSAGE_CHARS));
    return this.run("restart", args);
  }

  shutdown(): Promise<boolean> {
    return this.run("shutdown", ["/s", "/t", "0"]);
  }

  abort(): Promise<boolean> {
    return this.run("abort", ["/a"]);
  }

  private async run(action: string, args: readonly string[]): Promise<boolean> {
    const result = await this.exec.run("shutdown", args, { mutates: true });
    if (result.code !== 0) this.log.error("power_failed", { action, detail: result.stderr });
    else this.log.info("power", { action, args });
    return result.code === 0;
  }
}
