// Runs once when the Next.js server starts: fail fast on a misconfigured environment.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("./server/env");
    getEnv();
  }
}
