/** @internal Bounds the response while the cancelled operation finishes under its existing lock. */
export async function boundedOperation<T>(
  requestSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>,
  unavailable: () => T
): Promise<T> {
  if (requestSignal.aborted) return unavailable();
  const controller = new AbortController();
  const abort = () => controller.abort();
  requestSignal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 10_000);
  let onAbort!: () => void;
  const cancelled = new Promise<T>((resolve) => {
    onAbort = () => resolve(unavailable());
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    // Do not put lock cleanup here: the operation still owns it until it settles.
    const result = await Promise.race([
      operation(controller.signal),
      cancelled,
    ]);
    return controller.signal.aborted ? unavailable() : result;
  } finally {
    clearTimeout(timer);
    requestSignal.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
