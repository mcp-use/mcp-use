/**
 * Trusted-origin strategy (D29, D33): `webhook.trustedOrigins` (in dev,
 * exactly the local Inspector inbox prefix) are still verified by challenge
 * but exempt from the https and public-address rules; refused on requests
 * that arrived through the tunnel host.
 *
 * @internal
 */

import { matchesUrlPattern, type UrlPattern } from "./allowlist.js";

/** Result of the trusted-origin check. */
export type TrustedOriginCheck = "trusted" | "untrusted" | "refused_tunnel";

/**
 * Classify a callback URL against the trusted origins.
 *
 * @param viaTunnel - The subscribe request arrived through the tunnel host.
 */
export function checkTrustedOrigin(
  url: string,
  trusted: readonly UrlPattern[],
  viaTunnel: boolean
): TrustedOriginCheck {
  if (!matchesUrlPattern(url, trusted)) return "untrusted";
  return viaTunnel ? "refused_tunnel" : "trusted";
}
