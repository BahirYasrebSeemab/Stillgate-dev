import { MAX_PASSWORD_CHARS, MIN_PASSWORD_CHARS } from "./constants";
import { err, ok, type Result } from "./result";

// Rules for a NEW restore password (used by the manager UI and server)
export function checkNewPassword(password: string, confirmation: string): Result<string, string> {
  if (password !== confirmation) return err("the two passwords do not match");
  if (password.length < MIN_PASSWORD_CHARS) return err(`use at least ${MIN_PASSWORD_CHARS} characters`);
  if (password.length > MAX_PASSWORD_CHARS) return err(`use at most ${MAX_PASSWORD_CHARS} characters`);
  if (password.trim() !== password) return err("the password must not start or end with a space");
  return ok(password);
}
