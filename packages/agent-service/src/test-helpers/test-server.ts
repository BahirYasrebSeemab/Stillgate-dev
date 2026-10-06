import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { X509Certificate } from "node:crypto";
import { parseAgentMessage, type MachineId, type ServerToAgent } from "@stillgate/shared";
import { authMac, certFingerprint, randomHex, safeEqualHex } from "@stillgate/shared/node";
import { generate } from "selfsigned";
import { WebSocketServer, type WebSocket } from "ws";

// A tiny stand-in for the manager's server, just enough to test the agent's link.

export type TestServer = {
  readonly port: number;
  readonly fingerprint: string;
  readonly received: string[];
  readonly sockets: Set<WebSocket>;
  send(message: ServerToAgent): void;
  close(): Promise<void>;
};

export async function makeCert(): Promise<{ key: string; cert: string; fingerprint: string }> {
  const pems = await generate([{ name: "commonName", value: "stillgate-test" }], { keySize: 2048, algorithm: "sha256" });
  return { key: pems.private, cert: pems.cert, fingerprint: certFingerprint(new X509Certificate(pems.cert).raw) };
}

export async function startTestServer(machineId: MachineId, secret: string): Promise<TestServer> {
  const { key, cert, fingerprint } = await makeCert();
  const https: Server = createServer({ key, cert });
  const wss = new WebSocketServer({ server: https });
  const received: string[] = [];
  const sockets = new Set<WebSocket>();

  wss.on("connection", (socket) => {
    const nonce = randomHex(32);
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("message", (data) => {
      const parsed = parseAgentMessage(data.toString());
      if (!parsed.ok) return;
      const message = parsed.value;
      received.push(message.type);
      if (message.type === "hello") socket.send(JSON.stringify({ type: "auth_challenge", nonce }));
      if (message.type === "auth_response") {
        const good = safeEqualHex(message.mac, authMac(secret, nonce, machineId));
        socket.send(JSON.stringify(good ? { type: "auth_ok" } : { type: "error", code: "auth_failed", message: "no" }));
      }
      if (message.type === "pair_request") {
        socket.send(
          JSON.stringify({
            type: "pair_result",
            machineId,
            secret,
            password: { algo: "scrypt", salt: "c2FsdA==", hash: "aGFzaA==", params: { N: 16384, r: 8, p: 1, keylen: 64 }, version: 1 },
            policy: { version: 3, apps: [], sites: [] },
          }),
        );
      }
    });
  });

  await new Promise<void>((resolve) => https.listen(0, "127.0.0.1", resolve));
  const port = (https.address() as AddressInfo).port;
  return {
    port,
    fingerprint,
    received,
    sockets,
    send: (message) => {
      for (const socket of sockets) socket.send(JSON.stringify(message));
    },
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.terminate();
        wss.close();
        https.close(() => resolve());
      }),
  };
}
