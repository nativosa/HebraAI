// Equivalent to `err?.message ?? String(err)` (for string messages), typed for `unknown`.
export function errorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "message" in err && err.message != null) {
    return String(err.message);
  }
  return String(err);
}
