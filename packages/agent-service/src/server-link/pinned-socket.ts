import type { IncomingMessage } from "node:http";
import type { TLSSocket } from "node:tls";
import { MAX_MESSAGE_BYTES, AUTH_TIMEOUT_MS } from "@stillgate/shared";
import { certFingerprint, safeEqualHex, type Logger } from "@stillgate/shared/node";
import WebSocket from "ws";

// Opens a wss:// connection that trusts exactly ONE certificate: the one whose
// SHA-256 fingerprint was pinned at pairing. The normal CA system is ignored on purpose
// (rejectUnauthorized: false), and the fingerprint check below replaces it.
// The check runs on the "upgrade" event, which ws fires BEFORE "open",
// so not a single message is sent to a server with the wrong certificate.

export function openPinnedSocket(host: string, port: number, fingerprint: string, log: Logger): WebSocket {
  const socket = new WebSocket(`wss://${host}:${port}`, {
    rejectUnauthorized: false,
    maxPayload: MAX_MESSAGE_BYTES,
    handshakeTimeout: AUTH_TIMEOUT_MS,
    perMessageDeflate: false,
  });
  socket.on("upgrade", (response: IncomingMessage) => {
    const actual = peerFingerprint(response);
    if (actual === null || !safeEqualHex(actual, fingerprint)) {
      log.error("server_cert_mismatch", { host, expected: fingerprint, actual });
      socket.terminate();
    }
  });
  return socket;
}

function peerFingerprint(response: IncomingMessage): string | null {
  const tlsSocket = response.socket as TLSSocket;
  if (typeof tlsSocket.getPeerCertificate !== "function") return null;
  const cert = tlsSocket.getPeerCertificate();
  return cert.raw === undefined ? null : certFingerprint(cert.raw);
}

export function textOf(data: WebSocket.RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data as ArrayBuffer).toString("utf8");
}
