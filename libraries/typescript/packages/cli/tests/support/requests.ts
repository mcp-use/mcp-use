import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";

const pollingSignal = new AsyncLocalStorage<AbortSignal>();

/** Bound both response headers and body consumption; inherit a polling deadline. */
export function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {}
): Promise<Response> {
  const signals = [AbortSignal.timeout(10_000)];
  const inherited = pollingSignal.getStore();
  if (inherited) signals.push(inherited);
  if (input instanceof Request) signals.push(input.signal);
  if (init.signal) signals.push(init.signal);
  return globalThis.fetch(input, { ...init, signal: AbortSignal.any(signals) });
}

/** A deadline applies during a probe, and aborts HTTP requests started by that probe. */
export async function waitFor<T>(
  probe: (signal: AbortSignal) => Promise<T | undefined>,
  { timeout = 15_000, interval = 200 } = {}
): Promise<T> {
  const controller = new AbortController();
  const error = new Error(`waitFor timed out after ${timeout}ms`);
  const timer = setTimeout(() => controller.abort(error), timeout);
  let lastError: unknown;
  let rejectAbort: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      controller.signal.throwIfAborted();
      try {
        const result = await Promise.race([
          pollingSignal.run(controller.signal, () => probe(controller.signal)),
          aborted,
        ]);
        if (result !== undefined) return result;
      } catch (failure) {
        if (controller.signal.aborted) throw error;
        lastError = failure;
      }
      await delay(interval, undefined, { signal: controller.signal });
    }
  } catch (failure) {
    if (controller.signal.aborted) {
      throw new Error(error.message, { cause: lastError ?? failure });
    }
    throw failure;
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
