/**
 * Raw capability sniffing (PLAN.md §9.2.1, D34). The raw `initialize` /
 * `server/discover` capabilities kept by the lane are the only source of
 * Events support: the SDK's capability schema strips the top-level `events`.
 *
 * @internal
 */

import {
  EVENTS_EXTENSION_ID,
  LEGACY_EVENTS_CAPABILITY,
} from "@mcp-use/events-core";

/** What a connection knows about a server's Events support. */
export interface ConnectionEventsInfo {
  /** Whether the server supports Events. */
  supported: boolean;
  /** How support was detected. */
  via: "extensions" | "top-level" | "probe" | "none" | "sdk_conflict";
  /** The dialect the advertisement suggests. */
  dialectHint: "openai" | "sep-3415" | undefined;
  /** Whether the server advertises `listChanged: true` for events. */
  listChanged: boolean;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Classify raw server capabilities.
 *
 * @param raw - Raw capabilities as received, or `undefined` before the handshake.
 * @returns The Events info; `supported: false, via: "none"` when nothing is advertised.
 */
export function sniffEventsCapability(
  raw: Record<string, unknown> | undefined
): ConnectionEventsInfo {
  const extensions = isObject(raw?.extensions) ? raw.extensions : undefined;
  const ext = extensions?.[EVENTS_EXTENSION_ID];
  if (isObject(ext)) {
    return {
      supported: true,
      via: "extensions",
      dialectHint: "sep-3415",
      listChanged: ext.listChanged === true,
    };
  }
  const top = raw?.[LEGACY_EVENTS_CAPABILITY];
  if (isObject(top)) {
    return {
      supported: true,
      via: "top-level",
      dialectHint: "openai",
      listChanged: top.listChanged === true,
    };
  }
  return {
    supported: false,
    via: "none",
    dialectHint: undefined,
    listChanged: false,
  };
}

/**
 * Merge unknown raw keys (`events`, `extensions`) into a capabilities cache so
 * `supports("events")` works (§9.2.1).
 *
 * @param cache - The SDK-parsed capabilities.
 * @param raw - Raw capabilities.
 * @returns A new object with the raw Events keys merged in.
 */
export function mergeRawEventsCapabilities(
  cache: Record<string, unknown> | null | undefined,
  raw: Record<string, unknown> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(cache ?? {}) };
  if (!raw) return out;
  if (raw[LEGACY_EVENTS_CAPABILITY] !== undefined) {
    out[LEGACY_EVENTS_CAPABILITY] = raw[LEGACY_EVENTS_CAPABILITY];
  }
  if (isObject(raw.extensions)) {
    out.extensions = {
      ...(isObject(out.extensions) ? out.extensions : {}),
      ...raw.extensions,
    };
  }
  return out;
}
