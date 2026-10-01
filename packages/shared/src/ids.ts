import { z } from "zod";

// Machine IDs are GUIDs assigned by the server at pairing
export const MachineId = z.uuid().brand<"MachineId">();
export type MachineId = z.infer<typeof MachineId>;

// App and site IDs: short lowercase names like "notepad" or "khan-academy"
const Slug = z.string().regex(/^[a-z0-9-]{1,40}$/, "use 1-40 lowercase letters, digits or -");

export const AppId = Slug.brand<"AppId">();
export type AppId = z.infer<typeof AppId>;

export const SiteId = Slug.brand<"SiteId">();
export type SiteId = z.infer<typeof SiteId>;

// 32 random bytes written as 64 lowercase hex characters (secrets, nonces, fingerprints)
export const Hex64 = z.string().regex(/^[0-9a-f]{64}$/, "expected 64 lowercase hex characters");
