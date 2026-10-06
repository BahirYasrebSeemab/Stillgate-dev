import { X509Certificate } from "node:crypto";
import { certFingerprint, type Logger } from "@stillgate/shared/node";
import { generate } from "selfsigned";
import type { SecretBox } from "../secret-box";
import type { ManagerStore } from "../store";

// The server's TLS certificate, created once on first run.
// It is self-signed: no certificate authority is involved, because every agent PINS its
// SHA-256 fingerprint at pairing. Valid for 20 years so it never expires under the PCs.
// The private key is stored sealed (encrypted with safeStorage / DPAPI).

const VALID_YEARS = 20;

export type TlsMaterial = { readonly key: string; readonly cert: string; readonly fingerprint: string };

export async function ensureCertificate(store: ManagerStore, box: SecretBox, log: Logger): Promise<TlsMaterial> {
  const existing = store.settings.value.tls;
  if (existing !== null) {
    return { key: box.open(existing.sealedKey), cert: existing.certPem, fingerprint: existing.fingerprint };
  }

  const notBeforeDate = new Date();
  const notAfterDate = new Date(notBeforeDate);
  notAfterDate.setFullYear(notAfterDate.getFullYear() + VALID_YEARS);
  const pems = await generate([{ name: "commonName", value: "Stillgate manager" }], {
    keySize: 2048,
    algorithm: "sha256",
    notBeforeDate,
    notAfterDate,
  });
  const fingerprint = certFingerprint(new X509Certificate(pems.cert).raw);
  await store.settings.update((settings) => ({
    ...settings,
    tls: { certPem: pems.cert, sealedKey: box.seal(pems.private), fingerprint },
  }));
  log.info("tls_certificate_created", { fingerprint });
  return { key: pems.private, cert: pems.cert, fingerprint };
}
