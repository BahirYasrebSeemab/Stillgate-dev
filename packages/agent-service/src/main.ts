import { createLogger } from "@stillgate/shared/node";
import { createAgent } from "./agent";
import { systemClock } from "./deps";
import { resolveAgentPaths } from "./paths";

// Service entry point. WinSW starts this with Node as SYSTEM and restarts it if it crashes.
// Set STILLGATE_LOG_ECHO=1 to also print the log to the console (handy in development).

async function main(): Promise<void> {
  const paths = resolveAgentPaths();
  const log = createLogger({ file: paths.logFile, echo: process.env["STILLGATE_LOG_ECHO"] === "1" });

  process.on("uncaughtException", (error) => {
    log.error("crash", { error });
    process.exit(1); // the service wrapper restarts us; state.json keeps the lock state
  });
  process.on("unhandledRejection", (reason) => log.error("unhandled_rejection", { error: reason }));

  const agent = await createAgent(paths, systemClock, log);
  await agent.start();

  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    log.info("agent_stopping", { signal });
    agent.stop().finally(() => process.exit(0));
  };
  // UNTESTED(windows): which signal WinSW's stop sends to node.exe
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) process.on(signal, () => stop(signal));
}

main().catch((error: unknown) => {
  process.stderr.write(`agent failed to start: ${String(error)}\n`);
  process.exit(1);
});
