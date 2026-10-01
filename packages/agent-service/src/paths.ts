import { join } from "node:path";

// Everything the agent stores lives in one folder:
//   Windows:  %ProgramData%\AsdLabLock      (ACL: SYSTEM + Administrators; set by the install script)
//   dev:      $ASD_DATA_DIR, or ./.dev-data (gitignored)

export type AgentPaths = {
  readonly dataDir: string;
  readonly configFile: string;
  readonly stateFile: string;
  readonly tokenFile: string;
  readonly controlDir: string;
  readonly logFile: string;
};

export function resolveAgentPaths(env: NodeJS.ProcessEnv = process.env): AgentPaths {
  const dataDir =
    env["ASD_DATA_DIR"] ??
    (env["ProgramData"] === undefined ? join(process.cwd(), ".dev-data", "agent") : join(env["ProgramData"], "AsdLabLock"));
  return {
    dataDir,
    configFile: join(dataDir, "config.json"),
    stateFile: join(dataDir, "state.json"),
    // Readable by the kiosk user too (separate ACL), so it lives in its own subfolder
    tokenFile: join(dataDir, "shell", "shell-token"),
    controlDir: join(dataDir, "control"),
    logFile: join(dataDir, "logs", "agent.log"),
  };
}
