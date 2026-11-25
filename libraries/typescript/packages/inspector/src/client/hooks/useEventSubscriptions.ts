import type { McpServer } from "@mcp-use/client/react";
import { useCallback, useEffect, useState } from "react";

/** SEP-3415 extension id (`io.modelcontextprotocol/events`). */
export const EVENTS_EXTENSION_ID = "io.modelcontextprotocol/events";
/** Legacy (ChatGPT-era) capability key. */
export const LEGACY_EVENTS_CAPABILITY = "events";

/** An event the server lists in `events/list`. */
export interface InspectorEventDescriptor {
  name: string;
  description?: string;
  delivery: Array<"webhook" | "push" | "poll">;
  inputSchema: Record<string, unknown>;
  payloadSchema: Record<string, unknown>;
  _meta?: Record<string, unknown>;
}

/** A webhook subscription the tab created. */
export interface InspectorSubscription {
  /** Server-issued subscription id. */
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  url: string;
  /** When the tab must refresh, or `null` for no expiry. */
  refreshBefore: string | null;
  /** Last cursor the server returned. */
  cursor: string | null;
  truncated: boolean;
  status: "active" | "ended";
}

/** One `events/poll` response, kept for the poll panel. */
export interface InspectorPollResponse {
  at: string;
  name: string;
  result: {
    events: Array<Record<string, unknown>>;
    cursor: string | null;
    truncated: boolean;
    hasMore: boolean;
    nextPollMs?: number;
  };
}

/**
 * Whether the connected server offers MCP Events under either the SEP-3415
 * extension or the legacy capability key.
 */
export function supportsEvents(server: McpServer | undefined): boolean {
  if (!server) return false;
  const caps = (server as { capabilities?: Record<string, unknown> })
    .capabilities;
  return (
    server.extensions?.[EVENTS_EXTENSION_ID] !== undefined ||
    caps?.[LEGACY_EVENTS_CAPABILITY] !== undefined ||
    (caps?.extensions as Record<string, unknown> | undefined)?.[
      EVENTS_EXTENSION_ID
    ] !== undefined
  );
}

type RawRequest = (
  method: string,
  params: Record<string, unknown>
) => Promise<unknown>;

function rawRequest(server: McpServer): RawRequest | undefined {
  const client = server.client;
  const name = client?.activeSessions[0];
  const session = name ? client?.getSession(name) : null;
  if (!session) return undefined;
  return (method, params) => session.request(method, params);
}

/** State and actions of {@link useEventSubscriptions}. */
export interface UseEventSubscriptionsResult {
  events: InspectorEventDescriptor[];
  subscriptions: InspectorSubscription[];
  polls: InspectorPollResponse[];
  error: string | null;
  loading: boolean;
  refreshCatalog: () => Promise<void>;
  subscribe: (o: {
    name: string;
    arguments: Record<string, unknown>;
    url: string;
    secret: string;
    cursor?: string | null;
    maxAgeMs?: number;
    ttlMs?: number | null;
  }) => Promise<InspectorSubscription | undefined>;
  unsubscribe: (sub: InspectorSubscription) => Promise<void>;
  poll: (o: {
    name: string;
    arguments: Record<string, unknown>;
    cursor?: string | null;
    maxAgeMs?: number;
  }) => Promise<InspectorPollResponse | undefined>;
  /** Marks a subscription ended (a `terminated` delivery arrived). */
  markEnded: (id: string) => void;
}

/**
 * Lists the server's events and drives webhook subscribe, refresh and
 * unsubscribe, plus `events/poll`, over the connected session.
 *
 * TODO(events): route through the `@mcp-use/client` events manager (WP-29)
 * once built, so refresh timers, the cursor store and `events/stream` push
 * reuse the same lane as every other client; this hook sends the raw
 * requests directly and refreshes on demand.
 */
export function useEventSubscriptions(
  server: McpServer | undefined
): UseEventSubscriptionsResult {
  const [events, setEvents] = useState<InspectorEventDescriptor[]>([]);
  const [subscriptions, setSubscriptions] = useState<InspectorSubscription[]>(
    []
  );
  const [polls, setPolls] = useState<InspectorPollResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const ready = server?.state === "ready";

  const call = useCallback(
    async <T>(method: string, params: Record<string, unknown>) => {
      const request = server ? rawRequest(server) : undefined;
      if (!request) throw new Error("not connected");
      return (await request(method, params)) as T;
    },
    [server]
  );

  const refreshCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all: InspectorEventDescriptor[] = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await call<{
          events: InspectorEventDescriptor[];
          nextCursor?: string;
        }>("events/list", cursor ? { cursor } : {});
        all.push(...(page.events ?? []));
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor)) break;
        if (cursor) seen.add(cursor);
      } while (cursor);
      setEvents(all);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => {
    if (ready && supportsEvents(server)) void refreshCatalog();
  }, [ready, server, refreshCatalog]);

  const subscribe: UseEventSubscriptionsResult["subscribe"] = useCallback(
    async (o) => {
      setError(null);
      try {
        const params: Record<string, unknown> = {
          name: o.name,
          arguments: o.arguments,
          delivery: { mode: "webhook", url: o.url, secret: o.secret },
        };
        if (o.cursor !== undefined) params.cursor = o.cursor;
        if (o.maxAgeMs !== undefined) params.maxAgeMs = o.maxAgeMs;
        if (o.ttlMs !== undefined) params.ttlMs = o.ttlMs;
        const result = await call<{
          id: string;
          refreshBefore: string | null;
          cursor: string | null;
          truncated: boolean;
        }>("events/subscribe", params);
        const sub: InspectorSubscription = {
          id: result.id,
          name: o.name,
          arguments: o.arguments,
          url: o.url,
          refreshBefore: result.refreshBefore,
          cursor: result.cursor,
          truncated: result.truncated,
          status: "active",
        };
        setSubscriptions((list) => [
          ...list.filter((s) => s.id !== sub.id),
          sub,
        ]);
        return sub;
      } catch (e) {
        setError((e as Error).message);
        return undefined;
      }
    },
    [call]
  );

  const unsubscribe = useCallback(
    async (sub: InspectorSubscription) => {
      try {
        await call("events/unsubscribe", {
          name: sub.name,
          arguments: sub.arguments,
          delivery: { mode: "webhook", url: sub.url },
        });
        setSubscriptions((list) => list.filter((s) => s.id !== sub.id));
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [call]
  );

  const poll: UseEventSubscriptionsResult["poll"] = useCallback(
    async (o) => {
      try {
        const params: Record<string, unknown> = {
          name: o.name,
          arguments: o.arguments,
        };
        if (o.cursor !== undefined) params.cursor = o.cursor;
        if (o.maxAgeMs !== undefined) params.maxAgeMs = o.maxAgeMs;
        const result = await call<InspectorPollResponse["result"]>(
          "events/poll",
          params
        );
        const entry = { at: new Date().toISOString(), name: o.name, result };
        setPolls((list) => [...list.slice(-49), entry]);
        return entry;
      } catch (e) {
        setError((e as Error).message);
        return undefined;
      }
    },
    [call]
  );

  const markEnded = useCallback((id: string) => {
    setSubscriptions((list) =>
      list.map((s) => (s.id === id ? { ...s, status: "ended" } : s))
    );
  }, []);

  return {
    events,
    subscriptions,
    polls,
    error,
    loading,
    refreshCatalog,
    subscribe,
    unsubscribe,
    poll,
    markEnded,
  };
}

/**
 * Checks on one poll response (§10.3): poll events carry no `cursor`,
 * `nextPollMs` is an integer ≥ 1000, and the cursor stays non-null once any
 * earlier cursor was non-null.
 */
export function pollChecks(
  response: InspectorPollResponse["result"],
  earlierNonNullCursor: boolean
): Array<{ id: string; ok: boolean; detail?: string }> {
  return [
    {
      id: "events-without-cursor",
      ok: response.events.every((e) => !("cursor" in e)),
    },
    {
      id: "nextPollMs",
      ok:
        response.nextPollMs === undefined ||
        (Number.isInteger(response.nextPollMs) && response.nextPollMs >= 1000),
      detail:
        response.nextPollMs === undefined
          ? "absent"
          : String(response.nextPollMs),
    },
    {
      id: "cursor-non-null",
      ok: !earlierNonNullCursor || response.cursor !== null,
    },
  ];
}
