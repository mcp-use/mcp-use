/**
 * Request signals (PLAN.md D27): what the server observes about the client
 * on an `events/*` request, and the projection stored on records.
 *
 * @internal
 */

import {
  MCP_METHOD_HEADER,
  readMcpNameHeader,
  type EventsSignals,
  type ProtocolEra,
} from "@mcp-use/events-core";
import type { SubscriptionRecordMeta } from "../internal/records.js";

/** Raw facts the transport layer hands to {@link collectSignals}. */
export interface SignalSource {
  era: ProtocolEra;
  protocolVersion?: string;
  /** Request headers. */
  headers: Headers;
  /** Client capabilities (modern envelope or the session's `initialize`). */
  capabilities?: Record<string, unknown>;
  clientInfo?: { name?: string; version?: string };
  /** `params.delivery.url` on subscribe/unsubscribe. */
  callbackUrl?: string;
  viaTunnel?: boolean;
}

/**
 * Collects the signals of one request.
 *
 * @param s - Transport facts.
 * @returns The signals.
 */
export function collectSignals(s: SignalSource): EventsSignals {
  const ext = (s.capabilities?.extensions ?? undefined) as
    | Record<string, unknown>
    | undefined;
  const mcpNameRaw = s.headers.get("Mcp-Name");
  const decoded = readMcpNameHeader(s.headers);
  const out: EventsSignals = {
    era: s.era,
    declaresEventsExtension:
      ext !== undefined &&
      ext !== null &&
      typeof ext === "object" &&
      ext["io.modelcontextprotocol/events"] !== undefined,
    mcpName:
      mcpNameRaw === null
        ? { present: false }
        : decoded === undefined
          ? { present: true }
          : { present: true, value: decoded },
    mcpMethod: s.headers.get(MCP_METHOD_HEADER) !== null,
  };
  if (s.protocolVersion !== undefined) out.protocolVersion = s.protocolVersion;
  if (s.clientInfo) out.clientInfo = { ...s.clientInfo };
  const ua = s.headers.get("user-agent");
  if (ua !== null) out.userAgent = ua;
  if (s.callbackUrl !== undefined) {
    try {
      out.callbackHost = new URL(s.callbackUrl).host;
    } catch {
      /* invalid URL: validated elsewhere */
    }
  }
  if (s.viaTunnel) out.viaTunnel = true;
  return out;
}

/**
 * Projects signals onto the stored `SubscriptionRecord.meta`.
 *
 * @param s - The signals.
 * @param extra - Deployment label and principal flags.
 * @returns The stored meta.
 */
export function projectSignals(
  s: EventsSignals,
  extra: { deployment?: string; anonymous?: boolean; dev?: boolean } = {}
): SubscriptionRecordMeta {
  const m: SubscriptionRecordMeta = {
    era: s.era,
    declared: s.declaresEventsExtension,
    mcpName: s.mcpName.present ? "present" : "missing",
  };
  if (s.clientInfo?.name !== undefined) m.clientName = s.clientInfo.name;
  if (s.clientInfo?.version !== undefined)
    m.clientVersion = s.clientInfo.version;
  if (s.userAgent !== undefined) m.userAgent = s.userAgent.slice(0, 256);
  if (s.mcpMethod !== undefined) m.mcpMethod = s.mcpMethod;
  if (extra.deployment !== undefined) m.deployment = extra.deployment;
  if (extra.anonymous) m.anonymous = true;
  if (extra.dev) m.dev = true;
  return m;
}
