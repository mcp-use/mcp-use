/**
 * Polls `probe` until it returns a value other than `undefined`, or throws
 * after `deadlineMs`. Deadlines come from `matrix.json` (measured p95), so
 * scenarios never sleep a fixed time.
 */
export async function waitUntil<T>(
  what: string,
  probe: () => Promise<T | undefined>,
  { deadlineMs, intervalMs = 200 }: { deadlineMs: number; intervalMs?: number }
): Promise<T> {
  const end = Date.now() + deadlineMs;
  let lastError: unknown;
  for (;;) {
    try {
      const value = await probe();
      if (value !== undefined) return value;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > end) {
      const reason = lastError instanceof Error ? `: ${lastError.message}` : "";
      throw new Error(
        `timed out after ${deadlineMs} ms waiting for ${what}${reason}`
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
