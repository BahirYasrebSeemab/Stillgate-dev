import { hostname } from "node:os";
import { EnforcementMode, PersistedState, decodePairing } from "@stillgate/shared";
import { createLogger, readJson, type Logger } from "@stillgate/shared/node";
import { ConfigStore, KioskConfig } from "./config";
import { pendingControlRequests, writeControlRequest } from "./control";
import { resolveAgentPaths, type AgentPaths } from "./paths";
import { pairWithServer } from "./server-link/pair";

// Admin command line (run as Administrator on the visitor PC):
//   node cli.js init --kiosk-user kiosk --kiosk-sid S-1-5-21-... --shell-exe "C:\...\kiosk-shell.exe"
//   node cli.js pair "sg1:192.168.1.10:47800:<fingerprint>:<code>"
//   node cli.js status
//   node cli.js set-enforcement audit|enforce
//   node cli.js set-dry-run on|off
//   node cli.js rearm

const USAGE = `usage: agent <command>
  init --kiosk-user <name> --kiosk-sid <SID> --shell-exe <path>
  pair "<pairing string>"
  status
  set-enforcement audit|enforce
  set-dry-run on|off
  rearm
`;

type Exit = { readonly code: number; readonly text: string };
const done = (text: string): Exit => ({ code: 0, text });
const fail = (text: string, code = 1): Exit => ({ code, text });

export async function runCli(args: readonly string[], paths: AgentPaths, log: Logger): Promise<Exit> {
  const [command, ...rest] = args;
  switch (command) {
    case "init":
      return init(rest, paths, log);
    case "pair":
      return pair(rest[0], paths, log);
    case "status":
      return status(paths, log);
    case "set-enforcement": {
      const mode = EnforcementMode.safeParse(rest[0]);
      if (!mode.success) return fail(USAGE, 2);
      await writeControlRequest(paths.controlDir, { cmd: "set-enforcement", mode: mode.data });
      return done(`enforcement will be set to "${mode.data}" by the running service`);
    }
    case "set-dry-run": {
      if (rest[0] !== "on" && rest[0] !== "off") return fail(USAGE, 2);
      await writeControlRequest(paths.controlDir, { cmd: "set-dry-run", value: rest[0] === "on" });
      return done(`dry-run will be turned ${rest[0]} by the running service`);
    }
    case "rearm":
      await writeControlRequest(paths.controlDir, { cmd: "rearm" });
      return done("rearm requested: maintenance ends and the PC restarts in 60 seconds");
    default:
      return fail(USAGE, 2);
  }
}

async function init(args: readonly string[], paths: AgentPaths, log: Logger): Promise<Exit> {
  const flags = parseFlags(args);
  const kiosk = KioskConfig.safeParse({
    user: flags.get("--kiosk-user"),
    sid: flags.get("--kiosk-sid"),
    shellExe: flags.get("--shell-exe"),
  });
  if (!kiosk.success) return fail(`invalid init options\n${USAGE}`, 2);
  const store = await ConfigStore.load(paths.configFile, log);
  await store.update((config) => ({ ...config, kiosk: kiosk.data }));
  await writeControlRequest(paths.controlDir, { cmd: "reload" });
  return done(`kiosk user set to ${kiosk.data.user} (${kiosk.data.sid})`);
}

async function pair(text: string | undefined, paths: AgentPaths, log: Logger): Promise<Exit> {
  if (text === undefined) return fail(USAGE, 2);
  const info = decodePairing(text);
  if (!info.ok) return fail(`invalid pairing string: ${info.error}`);

  const result = await pairWithServer(info.value, hostname(), log);
  if (!result.ok) return fail(`pairing failed: ${result.error}`);

  const { machineId, secret, password, policy } = result.value;
  const store = await ConfigStore.load(paths.configFile, log);
  await store.update((config) => ({
    ...config,
    server: { host: info.value.ip, port: info.value.port, fingerprint: info.value.fingerprint },
    machineId,
    secret,
    password,
    policy,
  }));
  await writeControlRequest(paths.controlDir, { cmd: "reload" });
  log.info("paired", { machineId, server: info.value.ip });
  return done(`paired with ${info.value.ip}:${info.value.port} as machine ${machineId}`);
}

async function status(paths: AgentPaths, log: Logger): Promise<Exit> {
  const config = (await ConfigStore.load(paths.configFile, log)).value;
  const saved = await readJson(paths.stateFile, PersistedState);
  const pending = await pendingControlRequests(paths.controlDir);
  const lines = [
    `data folder:   ${paths.dataDir}`,
    `paired:        ${config.machineId === undefined ? "no" : `yes (${config.machineId})`}`,
    `server:        ${config.server === undefined ? "-" : `${config.server.host}:${config.server.port}`}`,
    `kiosk user:    ${config.kiosk === undefined ? "NOT SET (run init)" : `${config.kiosk.user} ${config.kiosk.sid}`}`,
    `lock state:    ${saved.ok ? saved.value.state.kind : "unknown (service never ran)"}`,
    `dry-run:       ${config.dryRun ? "ON (Windows changes are only logged)" : "off"}`,
    `enforcement:   ${config.enforcement}`,
    `policy:        v${config.policy.version}, ${config.policy.apps.length} apps, ${config.policy.sites.length} sites`,
    `password:      ${config.password === undefined ? "not set" : `version ${config.password.version}`}`,
    `pending cmds:  ${pending.length}`,
  ];
  return done(lines.join("\n"));
}

function parseFlags(args: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i + 1 < args.length; i += 2) {
    const name = args[i];
    const value = args[i + 1];
    if (name !== undefined && value !== undefined) flags.set(name, value);
  }
  return flags;
}

if (require.main === module) {
  const paths = resolveAgentPaths();
  const log = createLogger({ file: paths.logFile });
  runCli(process.argv.slice(2), paths, log)
    .then((exit) => {
      (exit.code === 0 ? process.stdout : process.stderr).write(`${exit.text}\n`);
      process.exitCode = exit.code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`error: ${String(error)}\n`);
      process.exitCode = 1;
    });
}
