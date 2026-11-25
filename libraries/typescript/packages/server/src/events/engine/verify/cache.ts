/**
 * Verification cache (D29): success per `(principal, url)` for 24 h as
 * `ev:{ns}:verified:{h}` `{via, at}`; failures for 60 s as
 * `ev:{ns}:verifyfail:{h}` `{reason, at, until}`.
 *
 * @internal
 */

import type { DeliveryErrorCategory } from "@mcp-use/events-core";
import type { EngineContext } from "../jobs.js";

/** A verification strategy. */
export type VerifiedVia =
  | "challenge"
  | "allowlist"
  | "trusted-origin"
  | "well-known";

/** Cached success. */
export interface VerifiedEntry {
  via: VerifiedVia;
  at: number;
}

/** Cached failure. */
export interface VerifyFailEntry {
  reason: DeliveryErrorCategory;
  at: number;
  until: number;
}

/** Read a cached success. */
export async function readVerified(
  ctx: EngineContext,
  principal: string,
  url: string
): Promise<VerifiedEntry | undefined> {
  const got = await ctx.storage.read(ctx.keys.verified(principal, url));
  return got ? (JSON.parse(got.value) as VerifiedEntry) : undefined;
}

/** Cache a success and clear any cached failure. */
export async function writeVerified(
  ctx: EngineContext,
  principal: string,
  url: string,
  via: VerifiedVia,
  ttlMs: number
): Promise<void> {
  const entry: VerifiedEntry = { via, at: ctx.clock.now() };
  await ctx.storage.write(
    ctx.keys.verified(principal, url),
    JSON.stringify(entry),
    { ttlMs }
  );
  await ctx.storage.remove(ctx.keys.verifyFail(principal, url));
}

/** Read a live cached failure. */
export async function readVerifyFail(
  ctx: EngineContext,
  principal: string,
  url: string
): Promise<VerifyFailEntry | undefined> {
  const got = await ctx.storage.read(ctx.keys.verifyFail(principal, url));
  if (!got) return undefined;
  const e = JSON.parse(got.value) as VerifyFailEntry;
  return e.until > ctx.clock.now() ? e : undefined;
}

/** Cache a failure for `ttlMs`. */
export async function writeVerifyFail(
  ctx: EngineContext,
  principal: string,
  url: string,
  reason: DeliveryErrorCategory,
  ttlMs: number
): Promise<void> {
  const at = ctx.clock.now();
  const entry: VerifyFailEntry = { reason, at, until: at + ttlMs };
  await ctx.storage.write(
    ctx.keys.verifyFail(principal, url),
    JSON.stringify(entry),
    { ttlMs }
  );
}
