import { spawn } from "node:child_process";
import { EDGE_EXE } from "@asd/shared";
import type { Logger } from "@asd/shared/node";

// Starts programs AS THE KIOSK USER (this shell runs as that user).
// Paths and URLs always come from the agent's answer, never from the UI.
// spawn with an argument array: no shell, so nothing in a path or URL can run extra commands.
// UNTESTED(windows)

export function launchProgram(exePath: string, args: readonly string[], log: Logger): boolean {
  try {
    const child = spawn(exePath, [...args], { detached: true, stdio: "ignore", windowsHide: false });
    child.on("error", (error) => log.error("launch_failed", { exePath, error }));
    child.unref(); // the shell does not wait for the program
    log.info("launched", { exePath });
    return true;
  } catch (error) {
    log.error("launch_failed", { exePath, error });
    return false;
  }
}

// Sites always open in Microsoft Edge, which the agent has locked down with policies
export function openInEdge(url: string, log: Logger): boolean {
  return launchProgram(EDGE_EXE, [url], log);
}
