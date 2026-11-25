/**
 * Principal composition (PLAN.md D13): `events.principal(auth)` overrides
 * `ctx.auth.principal`; the dev principal `dev|local` (D13a); anonymous
 * webhooks for the `openai` profile on no-OAuth servers (D13b); anonymous
 * poll and push on no-OAuth servers (D13c).
 *
 * @internal
 */

import { EventsError } from "@mcp-use/events-core";

/** The dev principal (D13a). */
export const DEV_PRINCIPAL = "dev|local";
/** The anonymous principal (D13b, D13c). */
export const ANONYMOUS_PRINCIPAL = "anonymous";

/** Inputs of {@link resolvePrincipal}. */
export interface PrincipalInput {
  /** `ctx.auth` when OAuth authenticated the request. */
  auth?: { principal?: string | null } & Record<string, unknown>;
  /** `events.principal`. */
  principalHook?: (auth: never) => string | null | undefined;
  oauthConfigured: boolean;
  /** CLI dev runtime injected. */
  devRuntime: boolean;
  /** Request arrived through the dev tunnel host. */
  viaTunnel: boolean;
  /** `events.anonymous`, default `"auto"`. */
  anonymous?: "auto" | "reject" | "openai";
  mode: "webhook" | "poll" | "push";
  /** Resolved preset family. */
  preset: string;
}

/** A resolved principal. */
export interface ResolvedPrincipal {
  principal: string;
  anonymous: boolean;
  dev: boolean;
}

/**
 * Resolves the principal of an `events/*` request.
 *
 * @param i - Auth, config and request facts.
 * @returns The principal and flags.
 * @throws {@link EventsError} `forbidden` `{reason:"principal_required"}` when no source applies.
 */
export function resolvePrincipal(i: PrincipalInput): ResolvedPrincipal {
  if (i.auth) {
    const hooked = i.principalHook
      ? i.principalHook(i.auth as never)
      : i.auth.principal;
    if (typeof hooked === "string" && hooked.length > 0) {
      return { principal: hooked, anonymous: false, dev: false };
    }
  }
  if (!i.oauthConfigured) {
    if (i.devRuntime && !i.viaTunnel) {
      return { principal: DEV_PRINCIPAL, anonymous: false, dev: true };
    }
    if (i.mode !== "webhook") {
      return { principal: ANONYMOUS_PRINCIPAL, anonymous: true, dev: false };
    }
    if (anonymousWebhooksAllowed(i)) {
      return { principal: ANONYMOUS_PRINCIPAL, anonymous: true, dev: false };
    }
  } else if (!i.auth && anonymousWebhooksAllowed(i) && i.mode === "webhook") {
    return { principal: ANONYMOUS_PRINCIPAL, anonymous: true, dev: false };
  }
  throw new EventsError("forbidden", "A principal is required", {
    reason: "principal_required",
  });
}

/**
 * Whether anonymous webhook subscriptions are allowed (D13b): only for the
 * `openai` profile; `"auto"` iff no OAuth is configured; `"openai"` always;
 * `"reject"` never.
 *
 * @param i - Config and request facts.
 * @returns `true` when allowed.
 */
export function anonymousWebhooksAllowed(
  i: Pick<PrincipalInput, "anonymous" | "oauthConfigured" | "preset">
): boolean {
  if (i.preset !== "openai") return false;
  const policy = i.anonymous ?? "auto";
  if (policy === "reject") return false;
  if (policy === "openai") return true;
  return !i.oauthConfigured;
}
