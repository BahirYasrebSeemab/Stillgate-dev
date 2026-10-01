import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { z } from "zod";
import { errorMessage } from "../errors";
import { err, ok, type Result } from "../result";
import { describeZodError } from "../zod-util";
import { randomHex } from "./crypto";

export type ReadJsonError = { readonly kind: "missing" } | { readonly kind: "corrupt"; readonly detail: string };

// Reads a JSON file and validates it. Missing and corrupt files are normal results, not crashes.
export async function readJson<S extends z.ZodType>(
  file: string,
  schema: S,
): Promise<Result<z.output<S>, ReadJsonError>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (isNotFound(error)) return err({ kind: "missing" });
    return err({ kind: "corrupt", detail: errorMessage(error) });
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return err({ kind: "corrupt", detail: "not valid JSON" });
  }
  const parsed = schema.safeParse(data);
  return parsed.success ? ok(parsed.data) : err({ kind: "corrupt", detail: describeZodError(parsed.error) });
}

// Writes JSON so that a crash or power cut never leaves a half-written file:
// write a temp file -> flush it to disk (fsync) -> rename it over the real file.
// UNTESTED(windows): rename over an existing file relies on Node using MoveFileEx(REPLACE_EXISTING).
export async function writeJsonAtomic(file: string, data: unknown, mode = 0o600): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomHex(4)}.tmp`;
  try {
    const handle = await open(temp, "w", mode);
    try {
      await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
