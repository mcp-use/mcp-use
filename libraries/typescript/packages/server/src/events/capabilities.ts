/**
 * Era-aware Events capability advertisement (§6.4, D8, D78). The result feeds
 * `sdk-adapter.capabilitiesFor`, which builds the fragment passed to the SDK
 * server constructor.
 *
 * @internal
 */

import type { AdvertiseKeys } from "@mcp-use/events-core";

/** Facts the advertisement depends on; never the caller's principal. */
export interface AdvertiseInput {
  /** Number of registered events; zero advertises nothing. */
  registered: number;
  /** `compatibility.openai` (default true). */
  openai?: boolean;
  /** Events is off (probe P1 failed) or unconfigured in handler mode. */
  off?: boolean;
  /** The matched known-client row's `advertise`, if any. */
  rowAdvertise?: AdvertiseKeys;
}

/**
 * Which keys to advertise: the top-level legacy `events` key and the
 * `io.modelcontextprotocol/events` extension key (table in §6.4).
 *
 * @param era - Request era.
 * @param input - Server facts.
 */
export function advertiseFor(
  era: "legacy" | "modern",
  input: AdvertiseInput
): { legacyKey: boolean; extension: boolean } {
  if (input.registered === 0 || input.off === true) {
    return { legacyKey: false, extension: false };
  }
  const openai = input.openai !== false;
  if (era === "legacy") return { legacyKey: openai, extension: false };
  if (!openai) return { legacyKey: false, extension: true };
  switch (input.rowAdvertise) {
    case "top":
      return { legacyKey: true, extension: false };
    case "extension":
      return { legacyKey: false, extension: true };
    default:
      return { legacyKey: true, extension: true };
  }
}
