/**
 * Next.js instrumentation hook: runs once when the server starts, in the Node.js
 * runtime only (the edge runtime that serves middleware has no process.env to check).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("./lib/env");
    validateEnv();
  }
}
