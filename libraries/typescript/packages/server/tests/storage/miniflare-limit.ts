/**
 * Miniflare's Node-to-workerd proxy fails ("fetch failed", ECONNRESET)
 * under the conformance suite's 1,000 simultaneous calls; a Worker calling
 * its own binding has no such proxy. These wrappers keep at most `max`
 * calls in flight while the suite still issues them concurrently.
 */
import type { D1LikeDatabase } from "../../src/storage/adapters/cloudflare-d1.js";
import type { DurableObjectNamespaceLike } from "../../src/storage/adapters/cloudflare-do.js";

export function limiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active++;
    try {
      try {
        return await task();
      } catch (error) {
        // The proxy occasionally resets a reused keep-alive socket before
        // the request reaches workerd. One retry; if a retried call had in
        // fact run, the suite sees an extra seq or write and fails.
        const code = (error as { cause?: { code?: string } }).cause?.code;
        if (code !== "ECONNRESET") throw error;
        return await task();
      }
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

export function limitD1(db: D1LikeDatabase, max = 8): D1LikeDatabase {
  const limit = limiter(max);
  return {
    prepare: (query) => ({
      bind: (...values) => {
        const bound = db.prepare(query).bind(...values);
        return {
          first: () => limit(() => bound.first()),
          run: () => limit(() => bound.run()),
          all: () => limit(() => bound.all!()),
          // batch() needs the binding's own statement objects.
          raw: bound,
        } as typeof bound;
      },
    }),
    batch: (statements) =>
      limit(() =>
        db.batch!(
          statements.map((s) => (s as unknown as { raw: typeof s }).raw ?? s)
        )
      ),
  };
}

export function limitDurableObject(
  ns: DurableObjectNamespaceLike,
  max = 16
): DurableObjectNamespaceLike {
  const limit = limiter(max);
  return {
    idFromName: (name) => ns.idFromName(name),
    get: (id) => {
      const stub = ns.get(id);
      return { fetch: (input, init) => limit(() => stub.fetch(input, init)) };
    },
  };
}
