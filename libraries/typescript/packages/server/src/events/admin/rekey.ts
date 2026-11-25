/**
 * `rekey` (D22): re-seal records, jobs, dead letters and leases with the
 * first key of the keyring, within a time budget.
 *
 * @internal
 */

import type { ViewContext } from "./views.js";

/**
 * Re-seal every value reachable from the namespace indexes.
 *
 * @param ctx - Storage, keys and codec (first key seals).
 * @param budgetMs - Time budget; default 25 000.
 * @param now - Clock.
 */
export async function rekeyNamespace(
  ctx: ViewContext,
  budgetMs = 25_000,
  now: () => number = Date.now
): Promise<{ rewritten: number; remaining: number }> {
  const deadline = now() + budgetMs;
  const keys: string[] = [];
  const collect = async (index: string, toKeys: (id: string) => string[]) => {
    let after: string | undefined;
    for (;;) {
      const q: { limit: number; after?: string } = { limit: 500 };
      if (after !== undefined) q.after = after;
      const p = await ctx.storage.indexRange(index, q);
      for (const i of p.items) keys.push(...toKeys(i.member));
      if (p.next === undefined) break;
      after = p.next;
    }
  };
  keys.push(ctx.keys.catalog);
  await collect(ctx.keys.expiry, (id) => [
    ctx.keys.sub(id),
    ctx.keys.status(id),
  ]);
  await collect(ctx.keys.due, (id) => [ctx.keys.job(id)]);
  await collect(ctx.keys.dead, (id) => [ctx.keys.deadLetter(id)]);
  await collect(ctx.keys.leaseExpiry, (id) => [ctx.keys.lease(id)]);
  // TODO(events): re-seal log entries, attempt logs and the meta cursorKey
  // once WP-12 exposes log-entry and meta sealing.

  let rewritten = 0;
  let i = 0;
  for (; i < keys.length && now() < deadline; i++) {
    const key = keys[i] as string;
    const v = await ctx.storage.read(key);
    if (v === undefined) continue;
    const opened = await ctx.codec.open(key, v.value);
    const sealed = await ctx.codec.seal(key, opened);
    if (sealed === v.value) continue;
    if (
      (await ctx.storage.write(key, sealed, { ifVersion: v.version })) !== false
    )
      rewritten++;
  }
  return { rewritten, remaining: keys.length - i };
}
