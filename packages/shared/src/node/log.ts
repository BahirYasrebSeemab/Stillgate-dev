import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

// A tiny JSON-lines logger: one JSON object per line, rotated by size.
// Field names that look secret are always replaced with "[redacted]".

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export type LoggerOptions = {
  readonly file: string | null; // null = console only (tests, CLI)
  readonly maxBytes?: number;
  readonly keepFiles?: number;
  readonly echo?: boolean; // also print to stderr
};

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_KEEP_FILES = 3;
const SECRET_KEY = /pass|secret|token|hash|salt|private|cookie/i;
const MAX_DEPTH = 5;

export function createLogger(options: LoggerOptions): Logger {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const keep = options.keepFiles ?? DEFAULT_KEEP_FILES;
  let size = options.file === null ? 0 : currentSize(options.file);

  const write = (level: LogLevel, event: string, fields: LogFields = {}): void => {
    // Fields first, so a field can never overwrite the timestamp, level or event name
    const line = `${JSON.stringify({ ...redact(fields, 0), at: new Date().toISOString(), level, event })}\n`;
    if (options.echo) process.stderr.write(line);
    if (options.file === null) return;
    try {
      if (size + line.length > maxBytes) {
        rotate(options.file, keep);
        size = 0;
      }
      mkdirSync(dirname(options.file), { recursive: true });
      appendFileSync(options.file, line, "utf8");
      size += line.length;
    } catch (error) {
      process.stderr.write(`log write failed: ${String(error)}\n`);
    }
  };

  return {
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}

// A logger that throws everything away (handy in tests)
export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

export function redact(value: LogFields, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) out[key] = "[redacted]";
    else if (depth < MAX_DEPTH && isPlainObject(field)) out[key] = redact(field, depth + 1);
    else if (field instanceof Error) out[key] = field.message;
    else out[key] = field;
  }
  return out;
}

function isPlainObject(value: unknown): value is LogFields {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Error);
}

function currentSize(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

// agent.log -> agent.log.1 -> agent.log.2 ... the oldest one is deleted
function rotate(file: string, keep: number): void {
  rmSync(`${file}.${keep}`, { force: true });
  for (let i = keep - 1; i >= 1; i--) {
    try {
      renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    } catch {
      // that numbered file does not exist yet
    }
  }
  try {
    renameSync(file, `${file}.1`);
  } catch {
    // nothing to rotate
  }
}
