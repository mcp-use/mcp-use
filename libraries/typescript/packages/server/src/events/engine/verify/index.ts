/**
 * Callback verification (D29, PLAN.md §8.13). Runs inside `events/subscribe`
 * for creates and lapsed re-creates; a refresh of a live record never calls
 * it. Order: cached success → cached failure → allowlist → trusted origin
 * (challenge, exempt from https/public rules) → well-known → challenge.
 * Every challenge POST is rate-limited and recorded as a `"verification"`
 * attempt.
 *
 * @internal
 */

import type { DeliveryErrorCategory, ProfileAxes } from "@mcp-use/events-core";
import { EVENTS_DEFAULTS } from "../../config.js";
import { appendAttempt } from "../attempt.js";
import { callbackHost, type EngineContext } from "../jobs.js";
import { matchesUrlPattern, type UrlPattern } from "./allowlist.js";
import {
  readVerified,
  readVerifyFail,
  writeVerified,
  writeVerifyFail,
  type VerifiedVia,
} from "./cache.js";
import { runChallenge } from "./challenge.js";
import { acquireVerifySlot, type VerifyLimits } from "./limits.js";
import { checkTrustedOrigin } from "./trusted-origin.js";
import { WellKnownCache, type WellKnownFetch } from "./well-known.js";

export { matchesUrlPattern, type UrlPattern } from "./allowlist.js";
export {
  WellKnownCache,
  cacheTtl,
  WELL_KNOWN_RECEIVER_PATH,
} from "./well-known.js";

/** One verification request. */
export interface VerifyRequest {
  url: string;
  secret: string;
  subscriptionId: string;
  principal: string;
  axes: ProfileAxes;
  /** Known-client row override of the timeout (`verificationTimeoutMs`). */
  verificationTimeoutMs?: number;
  /** Known-client row override of anti-reflection. */
  antiReflection?: "warn" | "reject";
  /** The subscribe request arrived through the tunnel host. */
  viaTunnel?: boolean;
  signal?: AbortSignal;
}

/** Verification result. */
export type VerifyResult =
  | { ok: true; via: VerifiedVia; warning?: "reflected"; cached?: true }
  | {
      ok: false;
      reason: DeliveryErrorCategory;
      retryAfterMs?: number;
      /** The failure came from the cache or a rate limit (sep → ResourceExhausted). */
      limited?: true;
    };

/** The internal verifier seam. */
export interface Verifier {
  verify(req: VerifyRequest): Promise<VerifyResult>;
}

/** Verifier configuration (resolved from `webhook.*`). */
export interface VerifierOptions {
  allowlist?: readonly UrlPattern[];
  trustedOrigins?: readonly UrlPattern[];
  timeoutMs?: number;
  cacheTtlMs?: number;
  failureTtlMs?: number;
  antiReflection?: "warn" | "reject";
  limits?: Partial<VerifyLimits>;
  /** GET through the SSRF path; without it the well-known strategy is off. */
  fetchWellKnown?: WellKnownFetch;
}

/** Create the engine verifier. */
export function createVerifier(
  ctx: EngineContext,
  o: VerifierOptions = {}
): Verifier {
  const d = EVENTS_DEFAULTS;
  const timeoutMs = o.timeoutMs ?? d.verificationTimeoutMs;
  const cacheTtlMs = o.cacheTtlMs ?? d.verificationCacheTtlMs;
  const failureTtlMs = o.failureTtlMs ?? d.verificationFailureTtlMs;
  const limits: VerifyLimits = {
    inFlightPerHost:
      o.limits?.inFlightPerHost ?? d.verificationsInFlightPerHost,
    perPrincipalHostPerMinute:
      o.limits?.perPrincipalHostPerMinute ??
      d.verificationsPerPrincipalHostPerMinute,
    perHostPerMinute:
      o.limits?.perHostPerMinute ?? d.verificationsPerHostPerMinute,
  };
  const wellKnown = o.fetchWellKnown
    ? new WellKnownCache(o.fetchWellKnown, ctx.clock)
    : null;

  const succeed = async (
    req: VerifyRequest,
    via: VerifiedVia,
    warning?: "reflected",
    ms = 0
  ): Promise<VerifyResult> => {
    await writeVerified(ctx, req.principal, req.url, via, cacheTtlMs);
    ctx.log({
      type: "verify",
      callbackHost: callbackHost(req.url),
      via,
      outcome: warning ?? "ok",
      cached: false,
      ms,
    });
    return warning ? { ok: true, via, warning } : { ok: true, via };
  };

  const fail = async (
    req: VerifyRequest,
    reason: DeliveryErrorCategory,
    ms = 0
  ): Promise<VerifyResult> => {
    await writeVerifyFail(ctx, req.principal, req.url, reason, failureTtlMs);
    ctx.log({
      type: "verify",
      callbackHost: callbackHost(req.url),
      outcome: reason,
      cached: false,
      ms,
    });
    return { ok: false, reason, retryAfterMs: failureTtlMs };
  };

  return {
    async verify(req) {
      const cached = await readVerified(ctx, req.principal, req.url);
      if (cached) return { ok: true, via: cached.via, cached: true };
      const failed = await readVerifyFail(ctx, req.principal, req.url);
      if (failed)
        return {
          ok: false,
          reason: failed.reason,
          retryAfterMs: Math.max(0, failed.until - ctx.clock.now()),
          limited: true,
        };

      if (o.allowlist && matchesUrlPattern(req.url, o.allowlist))
        return succeed(req, "allowlist");

      const trusted = checkTrustedOrigin(
        req.url,
        o.trustedOrigins ?? [],
        req.viaTunnel ?? false
      );
      if (trusted === "refused_tunnel") return fail(req, "connection_refused");

      const t = req.verificationTimeoutMs ?? timeoutMs;
      if (
        trusted === "untrusted" &&
        wellKnown &&
        (await wellKnown.covers(req.url, t, req.signal))
      )
        return succeed(req, "well-known");

      const host = callbackHost(req.url);
      const slot = await acquireVerifySlot(ctx, req.principal, host, limits, t);
      if (!slot.ok)
        return {
          ok: false,
          reason: "challenge_failed",
          retryAfterMs: slot.retryAfterMs,
          limited: true,
        };
      try {
        const r = await runChallenge({
          url: req.url,
          secret: req.secret,
          subscriptionId: req.subscriptionId,
          send: ctx.send,
          clock: ctx.clock,
          timeoutMs: t,
          connectTimeoutMs: Math.min(ctx.config.connectTimeoutMs, t),
          antiReflection: req.antiReflection ?? o.antiReflection ?? "warn",
          ...(req.signal ? { signal: req.signal } : {}),
        });
        await appendAttempt(ctx, req.subscriptionId, {
          at: ctx.clock.now(),
          kind: "verification",
          webhookId: r.webhookId,
          attempt: 1,
          outcome: r.ok ? "ack" : r.reason,
          ...(r.status !== undefined ? { httpStatus: r.status } : {}),
          ms: r.ms,
        });
        const via: VerifiedVia =
          trusted === "trusted" ? "trusted-origin" : "challenge";
        return r.ok
          ? succeed(req, via, r.warning, r.ms)
          : fail(req, r.reason, r.ms);
      } finally {
        await slot.release();
      }
    },
  };
}
