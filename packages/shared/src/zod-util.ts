import type { z } from "zod";
import { err, ok, type Result } from "./result";

const MAX_ISSUES_SHOWN = 3;

// Turns a zod error into one short, readable line (for logs and UI)
export function describeZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, MAX_ISSUES_SHOWN)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

// Validate already-parsed data against a schema and return a Result
export function validate<S extends z.ZodType>(schema: S, data: unknown): Result<z.output<S>, string> {
  const parsed = schema.safeParse(data);
  return parsed.success ? ok(parsed.data) : err(describeZodError(parsed.error));
}

// Size-check, JSON-parse and validate a raw text message
export function parseJsonMessage<S extends z.ZodType>(
  schema: S,
  raw: string,
  maxBytes: number,
): Result<z.output<S>, string> {
  if (utf8Length(raw) > maxBytes) return err(`message larger than ${maxBytes} bytes`);
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return err("message is not valid JSON");
  }
  return validate(schema, data);
}

export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}
