import type { Implementation } from "@modelcontextprotocol/server";

import { UI_META_KEY } from "./constants.js";

/**
 * Suffix of the sandbox origin Claude serves view resources from.
 *
 * A domain already ending in this suffix is a computed value, so hashing is
 * idempotent.
 */
const CLAUDE_RESOURCE_DOMAIN_SUFFIX = ".claudemcpcontent.com";

/** Number of leading hex characters of the digest used as the subdomain. */
const CLAUDE_RESOURCE_DOMAIN_HASH_LENGTH = 32;

/**
 * Whether the requesting client is a Claude host.
 *
 * Matched on the advertised client name only, case-insensitively, as a
 * substring — the same rule v1 shipped, so servers upgrading from v1 keep
 * classifying the same clients.
 *
 * @param clientInfo - Client identity for the current request, or `undefined`
 * when the request carried none.
 * @returns `true` when the client name contains `claude`.
 */
export function isClaudeClient(
  clientInfo: Partial<Implementation> | undefined
): boolean {
  const name = clientInfo?.name;
  return typeof name === "string" && name.toLowerCase().includes("claude");
}

/**
 * Derive the `*.claudemcpcontent.com` domain Claude expects for an authored
 * `view.domain`.
 *
 * The subdomain is the first 32 hex characters of the SHA-256 digest of the
 * authored domain string verbatim, path included. Idempotent: a value that
 * already ends in the Claude suffix is returned unchanged.
 *
 * @param domain - Authored `view.domain` string, verbatim.
 * @returns The hashed Claude resource domain.
 */
export async function computeClaudeResourceDomain(
  domain: string
): Promise<string> {
  if (domain.endsWith(CLAUDE_RESOURCE_DOMAIN_SUFFIX)) {
    return domain;
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(domain)
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

  return `${hex.slice(0, CLAUDE_RESOURCE_DOMAIN_HASH_LENGTH)}${CLAUDE_RESOURCE_DOMAIN_SUFFIX}`;
}

/**
 * Rewrite `_meta.ui.domain` to its Claude form when the reading client is
 * Claude.
 *
 * Returns `meta` unchanged for every other client, and for a Claude client
 * when the view declares no domain. Only `domain` is replaced — the rest of
 * `_meta` and of `_meta.ui` passes through untouched.
 *
 * @param meta - Resource `_meta` as built for this read.
 * @param clientInfo - Client identity for the current request.
 * @param userAgent - HTTP user-agent fallback for legacy requests that carry
 * no per-request client identity.
 * @returns Resource `_meta` to send on the wire.
 */
export async function applyClaudeResourceDomain(
  meta: Record<string, unknown>,
  clientInfo: Partial<Implementation> | undefined,
  userAgent?: string | null
): Promise<Record<string, unknown>> {
  const effectiveClientInfo =
    typeof clientInfo?.name === "string" ||
    typeof userAgent !== "string" ||
    userAgent.trim().length === 0
      ? clientInfo
      : { ...clientInfo, name: userAgent.trim() };
  if (!isClaudeClient(effectiveClientInfo)) {
    return meta;
  }

  const ui = meta[UI_META_KEY];
  if (typeof ui !== "object" || ui === null || Array.isArray(ui)) {
    return meta;
  }

  const domain = (ui as Record<string, unknown>)["domain"];
  if (typeof domain !== "string" || domain.length === 0) {
    return meta;
  }

  return {
    ...meta,
    [UI_META_KEY]: {
      ...(ui as Record<string, unknown>),
      domain: await computeClaudeResourceDomain(domain),
    },
  };
}
