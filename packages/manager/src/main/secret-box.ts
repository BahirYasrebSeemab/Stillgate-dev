import { safeStorage } from "electron";

// Encrypts small secrets (machine secrets, the TLS private key) before they are written to disk.
// Electron's safeStorage uses Windows DPAPI: only this Windows user on this PC can decrypt.
export interface SecretBox {
  seal(plain: string): string;
  open(sealed: string): string;
}

export function safeStorageBox(): SecretBox {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS encryption (safeStorage) is not available; refusing to store secrets in plain text");
  }
  return {
    seal: (plain) => safeStorage.encryptString(plain).toString("base64"),
    open: (sealed) => safeStorage.decryptString(Buffer.from(sealed, "base64")),
  };
}
