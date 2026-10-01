// Turns anything that was thrown into a readable message.
// (In JS you can `throw` any value, so a catch block always receives `unknown`.)
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "unknown error";
}
