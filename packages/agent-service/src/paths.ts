import { join } from "node:path";
import { agentDataDir, shellTokenFile } from "@stillgate/shared/node";

// Everything the agent stores lives in one folder (see agentDataDir in @stillgate/shared/node):
//   Windows:  %ProgramData%\Stillgate      (ACL: SYSTEM + Administrators; set by the install script)
//   dev:      $STILLGATE_DATA_DIR, or ./.dev-data/agent (gitignored)

export type AgentPaths = {
  readonly dataDir: string;
  readonly configFile: string;
  readonly stateFile: string;
  readonly tokenFile: string;
  readonly controlDir: string;
  readonly logFile: string;
};

export function resolveAgentPaths(env: NodeJS.ProcessEnv = process.env): AgentPaths {
  const dataDir = agentDataDir(env);
  return {
    dataDir,
    configFile: join(dataDir, "config.json"),
    stateFile: join(dataDir, "state.json"),
    tokenFile: shellTokenFile(env), // readable by the kiosk user too (separate folder ACL)
    controlDir: join(dataDir, "control"),
    logFile: join(dataDir, "logs", "agent.log"),
  };
}
