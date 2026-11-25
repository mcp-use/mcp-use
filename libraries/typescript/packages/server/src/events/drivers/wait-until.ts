/**
 * `waitUntil` resolution (D19): explicit `events.waitUntil`, the threaded
 * runtime one, or the Hono `executionCtx` read in try/catch (its getter
 * throws outside Workers, CODE-m3).
 *
 * @internal
 */

/** A waitUntil function. */
export type WaitUntil = (p: Promise<unknown>) => void;

/**
 * Read `c.executionCtx.waitUntil` safely.
 *
 * @param c - A Hono context or anything with `executionCtx`.
 */
export function executionCtxWaitUntil(c: unknown): WaitUntil | undefined {
  try {
    const ctx = (c as { executionCtx?: { waitUntil?: WaitUntil } })
      .executionCtx;
    const w = ctx?.waitUntil;
    return typeof w === "function" ? w.bind(ctx) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Pick the first available waitUntil.
 *
 * @param candidates - In precedence order.
 */
export function resolveWaitUntil(
  ...candidates: Array<WaitUntil | undefined>
): WaitUntil | undefined {
  return candidates.find((c) => typeof c === "function");
}

/**
 * Run background work under waitUntil, or fire-and-forget with errors
 * reported. Never throws.
 *
 * @param waitUntil - Runtime waitUntil, if any.
 * @param work - The promise to keep alive.
 * @param onError - Error sink.
 */
export function runInBackground(
  waitUntil: WaitUntil | undefined,
  work: Promise<unknown>,
  onError?: (err: unknown) => void
): void {
  const guarded = work.catch((err) => onError?.(err));
  if (waitUntil !== undefined) {
    try {
      waitUntil(guarded);
    } catch (err) {
      onError?.(err);
    }
  }
}
