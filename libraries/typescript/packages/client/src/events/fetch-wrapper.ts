/**
 * The `Mcp-Name` / `Mcp-Param-*` fetch wrapper (PLAN.md §9.2.3, D34, D80).
 *
 * Installed on the SDK HTTP transport's `fetch`. It is permanent and a no-op
 * for a request that already carries the right values: headers are written
 * with `headers.set`, so an SDK-derived value is overwritten by the same
 * value and never appended. It also observes the response body of every lane
 * `events/stream` POST so the lane learns when a stream ended.
 *
 * @internal
 */

import {
  EVENTS_METHODS,
  MCP_NAME_HEADER,
  decodeHeaderValue,
  paramHeadersFor,
  setMcpNameHeader,
} from "@mcp-use/events-core";
import { EventsClientError } from "./types.js";
import type { SdkClientEventsAdapter } from "./sdk-adapter.js";
import {
  FIRST_MODERN_PROTOCOL_VERSION,
  LANE_ID_PREFIX,
} from "./sdk-adapter.js";

/** Methods that carry `Mcp-Name` on modern sessions. */
export const MCP_NAME_METHODS: ReadonlySet<string> = new Set([
  EVENTS_METHODS.subscribe,
  EVENTS_METHODS.unsubscribe,
  EVENTS_METHODS.poll,
  EVENTS_METHODS.stream,
]);

type LaneView = Pick<
  SdkClientEventsAdapter,
  "era" | "dialect" | "descriptors" | "callerHeaders" | "notifyStreamBodyEnd"
>;

function parseSingle(
  body: unknown
): { id?: unknown; method?: unknown; params?: unknown } | undefined {
  if (typeof body !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return undefined;
    return parsed as { id?: unknown; method?: unknown; params?: unknown };
  } catch {
    return undefined;
  }
}

function callerValue(
  callerHeaders: Record<string, string>,
  name: string
): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(callerHeaders)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/**
 * Wrap a fetch so `events/*` POSTs carry the right headers.
 *
 * @param base - The fetch to wrap.
 * @param lane - The lane (era, dialect, descriptor cache, caller headers).
 * @returns The wrapped fetch.
 * @throws {@link EventsClientError} `MCP_NAME_CONFLICT` when a caller-supplied `Mcp-Name` disagrees with `params.name`.
 */
export function createEventsFetchWrapper(
  base: typeof globalThis.fetch,
  lane: LaneView
): typeof globalThis.fetch {
  return async (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "POST") return base(input, init);
    const msg = parseSingle(init?.body);
    if (!msg || typeof msg.method !== "string") return base(input, init);
    const isLaneStream =
      msg.method === EVENTS_METHODS.stream &&
      typeof msg.id === "string" &&
      msg.id.startsWith(LANE_ID_PREFIX);
    let nextInit = init;
    if (MCP_NAME_METHODS.has(msg.method)) {
      const headers = new Headers(init?.headers);
      const pv = headers.get("mcp-protocol-version");
      const modern =
        pv !== null
          ? pv >= FIRST_MODERN_PROTOCOL_VERSION
          : lane.era() === "modern";
      const params =
        msg.params !== null && typeof msg.params === "object"
          ? (msg.params as Record<string, unknown>)
          : {};
      const name = typeof params.name === "string" ? params.name : undefined;
      if (modern && name !== undefined && lane.dialect.sendMcpName) {
        const supplied = callerValue(lane.callerHeaders, MCP_NAME_HEADER);
        if (supplied !== undefined) {
          const decoded = decodeHeaderValue(supplied) ?? supplied;
          if (decoded !== name) {
            throw new EventsClientError(
              "MCP_NAME_CONFLICT",
              `Caller-supplied Mcp-Name "${decoded}" disagrees with params.name "${name}"`,
              { name, data: { supplied: decoded } }
            );
          }
        }
        setMcpNameHeader(headers, name);
        const descriptor = lane.descriptors.get(name);
        if (descriptor) {
          const args =
            params.arguments !== null && typeof params.arguments === "object"
              ? (params.arguments as Record<string, unknown>)
              : {};
          for (const [k, v] of Object.entries(
            paramHeadersFor(descriptor, args)
          )) {
            headers.set(k, v);
          }
        }
        nextInit = { ...init, headers };
      }
    }
    const response = await base(input, nextInit);
    if (!isLaneStream || !response.body) return response;
    const id = msg.id as string;
    const observed = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        flush() {
          lane.notifyStreamBodyEnd(id);
        },
      })
    );
    return new Response(observed, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
