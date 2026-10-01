import { rename } from "node:fs/promises";
import type { z } from "zod";
import { readJson, writeJsonAtomic } from "./atomic-json";
import type { Logger } from "./log";

// Keeps one JSON file's contents in memory and saves every change atomically.
// Changes go through update(fn), where fn returns a NEW value (no mutation), and the result is
// validated against the schema before it is written, so a bad change can never reach disk.
// A corrupt file is moved aside (kept for inspection) and the safe fallback is used instead.
export class JsonFileStore<S extends z.ZodType> {
  private constructor(
    private current: z.output<S>,
    private readonly file: string,
    private readonly schema: S,
    private readonly fallback: z.output<S>,
  ) {}

  static async open<S extends z.ZodType>(
    file: string,
    schema: S,
    fallback: z.output<S>,
    log: Logger,
  ): Promise<JsonFileStore<S>> {
    return new JsonFileStore(await readOrFallback(file, schema, fallback, log), file, schema, fallback);
  }

  get value(): z.output<S> {
    return this.current;
  }

  // Re-read the file (after another process changed it)
  async reload(log: Logger): Promise<void> {
    this.current = await readOrFallback(this.file, this.schema, this.fallback, log);
  }

  async update(change: (value: z.output<S>) => z.output<S>): Promise<z.output<S>> {
    const next = this.schema.parse(change(this.current)) as z.output<S>;
    await writeJsonAtomic(this.file, next);
    this.current = next;
    return next;
  }
}

async function readOrFallback<S extends z.ZodType>(
  file: string,
  schema: S,
  fallback: z.output<S>,
  log: Logger,
): Promise<z.output<S>> {
  const result = await readJson(file, schema);
  if (result.ok) return result.value;
  if (result.error.kind === "corrupt") {
    const backup = `${file}.corrupt-${Date.now()}`;
    await rename(file, backup).catch(() => undefined);
    log.error("store_file_corrupt", { file, detail: result.error.detail, backup });
  }
  return fallback;
}
