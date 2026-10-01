import {
  APP_VERSION,
  PROTOCOL_VERSION,
  err,
  ok,
  parseServerMessage,
  type PairingInfo,
  type Result,
  type ServerToAgent,
} from "@asd/shared";
import type { Logger } from "@asd/shared/node";
import { openPinnedSocket, textOf } from "./pinned-socket";

// One-time pairing: connect to the server named in the pairing string, check its
// certificate fingerprint (from the same string), send the one-time code, and receive
// this PC's machine id, secret, the restore-password hash and the current policy.

export type PairResult = Extract<ServerToAgent, { type: "pair_result" }>;

const PAIR_TIMEOUT_MS = 15_000;

export function pairWithServer(info: PairingInfo, hostname: string, log: Logger): Promise<Result<PairResult, string>> {
  return new Promise((resolve) => {
    const socket = openPinnedSocket(info.ip, info.port, info.fingerprint, log);
    let settled = false;
    const finish = (result: Result<PairResult, string>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(result);
    };
    const timer = setTimeout(() => finish(err("timed out waiting for the server")), PAIR_TIMEOUT_MS);

    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          type: "pair_request",
          protocol: PROTOCOL_VERSION,
          code: info.code,
          hostname: hostname.slice(0, 63) || "pc",
          agentVersion: APP_VERSION,
        }),
      );
    });
    socket.on("message", (data) => {
      const parsed = parseServerMessage(textOf(data));
      if (!parsed.ok) return finish(err(`bad reply from server: ${parsed.error}`));
      const message = parsed.value;
      if (message.type === "pair_result") return finish(ok(message));
      if (message.type === "error") return finish(err(`server refused: ${message.message}`));
      return finish(err(`unexpected reply: ${message.type}`));
    });
    socket.on("error", (error) => finish(err(`connection failed: ${error.message}`)));
    socket.on("close", () => finish(err("connection closed (wrong certificate fingerprint, or server stopped)")));
  });
}
