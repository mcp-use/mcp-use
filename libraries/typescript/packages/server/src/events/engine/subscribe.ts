/**
 * `events/subscribe` (PLAN.md §6.7): the conformance-pinned validation order,
 * race-free create through the backend, `onSubscribe` with rollback, and
 * result shaping per profile.
 *
 * @internal
 */

import {
  EventsError,
  normalizeArguments,
  deriveSubscriptionId,
} from "@mcp-use/events-core";
import type { ProfileAxes } from "@mcp-use/events-core";
import type {
  EventsBackend,
  SubscribeInput,
  SubscriptionGrant,
} from "../internal/backend.js";
import type { RegisteredEvent, EventsRegistry } from "../internal/registry.js";
import type { SubscriptionRecord } from "../internal/records.js";
import type { DialectId, SubscriptionInfo } from "../types.js";
import { effectiveModes, profileModes, type ModeEnvironment } from "./list.js";
import { checkCreateQuotas, type QuotaCounts, type QuotaLimits } from "./quotas.js";
import { grantTtl, refreshBefore } from "./ttl.js";
import { subscribeCursorPolicy } from "./refresh.js";

/** Maximum callback URL length. */
export const MAX_CALLBACK_URL_LENGTH = 2048;

/**
 * Checks `delivery.secret` (step 4): `whsec_` + standard base64 (padding
 * optional) decoding to 24–64 bytes. URL-safe characters are rejected.
 */
export function isValidWebhookSecret(secret: unknown): secret is string {
  if (typeof secret !== "string" || !secret.startsWith("whsec_")) return false;
  const b64 = secret.slice(6);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return false;
  const body = b64.replace(/=+$/, "");
  if (body.length % 4 === 1) return false;
  const bytes = Math.floor((body.length * 3) / 4);
  return bytes >= 24 && bytes <= 64;
}

/**
 * Checks `delivery.url` (step 3): https or a trusted origin, no userinfo, at
 * most 2,048 characters, no loopback on a tunnel-host request.
 */
export function isValidCallbackUrl(
  url: unknown,
  o: { trustedOrigin(origin: string): boolean; tunnelRequest?: boolean }
): url is string {
  if (typeof url !== "string" || url.length > MAX_CALLBACK_URL_LENGTH)
    return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.username !== "" || u.password !== "") return false;
  const loopback = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(u.hostname);
  if (loopback && o.tunnelRequest === true) return false;
  return u.protocol === "https:" || o.trustedOrigin(u.origin);
}

/** Wire parameters of `events/subscribe` (already known to be an object). */
export interface SubscribeParams {
  name?: unknown;
  arguments?: unknown;
  delivery?: unknown;
  cursor?: unknown;
  maxAgeMs?: unknown;
}

/** Request-scoped collaborators of {@link handleSubscribe}. */
export interface SubscribeDeps {
  registry: EventsRegistry;
  backend: EventsBackend;
  now(): number;
  axes: ProfileAxes;
  profile: SubscribeInput["profile"];
  meta: SubscriptionRecord["meta"];
  env: ModeEnvironment;
  /** `ttlDefaultMs` of the matched known-client row. */
  rowTtlDefaultMs?: number;
  /** `events.ttl.allowNoExpiry`. */
  allowNoExpiry?: boolean;
  isDormant(name: string): boolean;
  isVisible(ev: RegisteredEvent): Promise<boolean>;
  trustedOrigin(origin: string): boolean;
  tunnelRequest?: boolean;
  /** Validates normalized arguments against `inputSchema`; throws InvalidParams `{field:"arguments", issues}`. */
  validateArgs(ev: RegisteredEvent, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Resolves the caller's principal for this profile, or `null`. */
  principal(): string | null;
  /** Runs `authorize(args, ctx)`. */
  authorize(ev: RegisteredEvent, args: Record<string, unknown>): Promise<boolean>;
  /** Namespace decommissioned (D68). */
  isClosed(): Promise<boolean>;
  /** Reads a stored record by id (refresh vs create). */
  findRecord(id: string): Promise<SubscriptionRecord | null>;
  quotaCounts: QuotaCounts;
  quotaLimits?: QuotaLimits;
  /** Callback verification (D29) incl. its rate limits; throws on failure. */
  verify(url: string, principal: string, secret: string): Promise<void>;
  /** Runs `onSubscribe(info, ctx)`; throws to refuse. */
  onSubscribe(ev: RegisteredEvent, info: SubscriptionInfo<Record<string, unknown>>): Promise<void>;
}

/** Result of `events/subscribe` before `resultType` is added by the responder. */
export interface SubscribeResultWire {
  id: string;
  refreshBefore: string | null;
  cursor: string | null;
  truncated: boolean;
  deliveryStatus?: SubscriptionGrant["deliveryStatus"];
}

const invalid = (field: string, extra?: Record<string, unknown>): EventsError =>
  new EventsError("invalidParams", "", { field, ...extra });

/**
 * Runs the §6.7 validation order and creates or refreshes the subscription.
 *
 * @throws EventsError at the first failing step.
 */
export async function handleSubscribe(
  params: SubscribeParams,
  deps: SubscribeDeps
): Promise<SubscribeResultWire> {
  // Step 1: name.
  const name = typeof params.name === "string" ? params.name : "";
  const ev = deps.registry.get(name);
  if (!ev || deps.isDormant(name) || !(await deps.isVisible(ev)))
    throw new EventsError("notFound", "", { kind: "event" });
  // Step 2: mode.
  const delivery =
    params.delivery !== null && typeof params.delivery === "object"
      ? (params.delivery as Record<string, unknown>)
      : {};
  const mode = delivery.mode ?? "webhook";
  if (
    mode !== "webhook" ||
    !profileModes(effectiveModes(ev, deps.env), deps.axes.listedModes).includes(
      "webhook"
    )
  )
    throw new EventsError("unsupported", "", {
      feature: "deliveryMode",
      value: mode,
    });
  // Step 3: url.
  if (
    !isValidCallbackUrl(delivery.url, {
      trustedOrigin: deps.trustedOrigin,
      tunnelRequest: deps.tunnelRequest === true,
    })
  )
    throw invalid("delivery.url");
  const url = delivery.url;
  // Step 4: secret.
  if (!isValidWebhookSecret(delivery.secret)) throw invalid("delivery.secret");
  const secret = delivery.secret;
  const ttlRaw = delivery.ttlMs;
  if (
    ttlRaw !== undefined &&
    ttlRaw !== null &&
    (typeof ttlRaw !== "number" || !Number.isFinite(ttlRaw) || ttlRaw < 0)
  )
    throw invalid("delivery.ttlMs");
  // Step 5: arguments.
  const args = await deps.validateArgs(ev, normalizeArguments(params.arguments));
  // Step 5a: cursor and maxAgeMs.
  if (
    params.cursor !== undefined &&
    params.cursor !== null &&
    typeof params.cursor !== "string"
  )
    throw invalid("cursor");
  if (
    params.maxAgeMs !== undefined &&
    (typeof params.maxAgeMs !== "number" ||
      !Number.isInteger(params.maxAgeMs) ||
      params.maxAgeMs < 0)
  )
    throw invalid("maxAgeMs");
  // Step 6: principal, tombstone, authorize, closed.
  const principal = deps.principal();
  if (principal === null)
    throw new EventsError("forbidden", "", { reason: "principal_required" });
  const key = { principal, url, name, args };
  if (await deps.backend.isRevoked(key))
    throw new EventsError("forbidden", "", { reason: "revoked" });
  if (!(await deps.authorize(ev, args)))
    throw new EventsError("forbidden", "", { reason: "not_authorized" });
  if (await deps.isClosed())
    throw new EventsError("forbidden", "", { reason: "closed" });

  const id = await deriveSubscriptionId({ principal, url, name, arguments: args });
  const now = deps.now();
  const existing = await deps.findRecord(id);
  const live =
    existing !== null &&
    existing.start !== null &&
    (existing.expiresAt === null || existing.expiresAt > now);
  // Steps 7 and 8: create (or lapsed) only.
  if (existing === null) await checkCreateQuotas({ principal, url }, deps.quotaCounts, deps.quotaLimits);
  if (!live) await deps.verify(url, principal, secret);

  const ttl = grantTtl({
    requested: ttlRaw as number | null | undefined,
    backend: deps.backend.capabilities,
    allowNoExpiry: deps.allowNoExpiry === true,
    ...(deps.rowTtlDefaultMs !== undefined ? { rowDefaultMs: deps.rowTtlDefaultMs } : {}),
    ...(ev.definition.ttl !== undefined ? { eventTtl: ev.definition.ttl } : {}),
  });
  const policy = subscribeCursorPolicy({
    record: existing,
    now,
    replayable: ev.replay !== false,
    replayCursors: deps.axes.replayCursors,
  });
  const grant = await deps.backend.subscribe(
    {
      key,
      secret,
      grantTtlMs: ttl,
      profile: deps.profile,
      partition:
        ev.partitionBy !== null && args[ev.partitionBy] !== undefined
          ? String(args[ev.partitionBy])
          : null,
      meta: deps.meta,
      cursor: policy.useCursor ? ((params.cursor as string | null | undefined) ?? null) : null,
      ...(policy.useCursor && params.maxAgeMs !== undefined
        ? { maxAgeMs: params.maxAgeMs as number }
        : {}),
    },
    { now }
  );
  // Step 9: onSubscribe on create only; a throw rolls the record back.
  if (grant.created && ev.hooks.onSubscribe) {
    try {
      await deps.onSubscribe(ev, {
        id: grant.id,
        name,
        args,
        principal,
        dialect: deps.profile.preset as DialectId,
        mode: "webhook",
        callbackOrigin: new URL(url).origin,
        expiresAt: ttl === null ? null : new Date(now + ttl),
        created: true,
      });
    } catch (err) {
      // TODO(events): the rollback must not enqueue an "unsubscribed" hook job; WP-20's backend.unsubscribe needs a `{rollback:true}` flag.
      await deps.backend.unsubscribe(key, { now });
      throw err;
    }
  }
  return shapeSubscribeResult(grant, deps.axes, policy.cursorsOn, now, ttl);
}

/** Shapes the wire result for the profile (§6.7 "Result"). */
export function shapeSubscribeResult(
  grant: SubscriptionGrant,
  axes: Pick<ProfileAxes, "refreshDeliveryStatus">,
  cursorsOn: boolean,
  now: number,
  ttlMs: number | null
): SubscribeResultWire {
  const out: SubscribeResultWire = {
    id: grant.id,
    refreshBefore: grant.refreshBefore ?? refreshBefore(now, ttlMs),
    cursor: cursorsOn ? grant.cursor : null,
    truncated: cursorsOn ? grant.truncated : false,
  };
  if (!grant.created && axes.refreshDeliveryStatus && grant.deliveryStatus)
    out.deliveryStatus = grant.deliveryStatus;
  return out;
}
