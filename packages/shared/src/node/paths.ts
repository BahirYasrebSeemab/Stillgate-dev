import { join } from "node:path";

// Where the agent keeps its files, shared so the kiosk shell finds the same token file.
//   Windows:  %ProgramData%\Stillgate
//   dev:      $STILLGATE_DATA_DIR, or ./.dev-data/agent
export function agentDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env["STILLGATE_DATA_DIR"];
  if (override !== undefined) return override;
  const programData = env["ProgramData"];
  return programData === undefined ? join(process.cwd(), ".dev-data", "agent") : join(programData, "Stillgate");
}

// The token file sits in its own subfolder, because only that folder is readable by the kiosk user
export function shellTokenFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(agentDataDir(env), "shell", "shell-token");
}
