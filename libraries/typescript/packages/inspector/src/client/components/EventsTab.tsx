import type { McpServer } from "@mcp-use/client/react";
import {
  listEvents,
  subscribeEvent,
  unsubscribeEvent,
  type EventInfo,
  type EventsRequester,
} from "@mcp-use/client/events";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/client/components/ui/button";
import { inspectorApi } from "@/client/utils/basePath";

/** Whether the server advertises MCP Events (`capabilities.events`). */
export function supportsEvents(server: McpServer | undefined): boolean {
  return server?.capabilities?.events !== undefined;
}

interface InboxDelivery {
  receivedAt: string;
  webhookId: string | null;
  subscriptionId: string | null;
  verified: boolean;
  kind: "verification" | "event";
  body: unknown;
}

interface ActiveSubscription {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  url: string;
  refreshBefore: string | null;
}

function sessionOf(server: McpServer): EventsRequester | undefined {
  const client = server.client;
  const name = client?.activeSessions[0];
  const session = name ? client?.getSession(name) : null;
  return session ?? undefined;
}

/**
 * The Events tab: the server's events, a subscribe form whose callback is
 * the Inspector's webhook inbox, and the deliveries the inbox received.
 */
export function EventsTab({ server }: { server: McpServer }) {
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [selected, setSelected] = useState("");
  const [args, setArgs] = useState("{}");
  const [inbox, setInbox] = useState<{
    id: string;
    secret: string;
    url: string;
  }>();
  const [subs, setSubs] = useState<ActiveSubscription[]>([]);
  const [deliveries, setDeliveries] = useState<InboxDelivery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ready = server.state === "ready";

  useEffect(() => {
    const session = sessionOf(server);
    if (!ready || !session) return;
    listEvents(session)
      .then((list) => {
        setEvents(list);
        setSelected((s) => s || list[0]?.name || "");
      })
      .catch((e: Error) => setError(e.message));
  }, [server, ready]);

  useEffect(() => {
    fetch(inspectorApi("events/inboxes"), { method: "POST" })
      .then((r) => r.json())
      .then((b: { id: string; secret: string; path: string }) =>
        setInbox({
          id: b.id,
          secret: b.secret,
          url: `${window.location.origin}${b.path}`,
        })
      )
      .catch((e: Error) => setError(`inbox: ${e.message}`));
  }, []);

  useEffect(() => {
    if (!inbox) return;
    const timer = setInterval(() => {
      fetch(inspectorApi(`events/inboxes/${inbox.id}`))
        .then((r) => r.json())
        .then((b: { deliveries?: InboxDelivery[] }) =>
          setDeliveries(b.deliveries ?? [])
        )
        .catch(() => undefined);
    }, 1500);
    return () => clearInterval(timer);
  }, [inbox]);

  const subscribe = useCallback(async () => {
    setError(null);
    const session = sessionOf(server);
    if (!session || !inbox) return;
    try {
      const parsed = JSON.parse(args || "{}") as Record<string, unknown>;
      const result = await subscribeEvent(session, {
        name: selected,
        arguments: parsed,
        url: inbox.url,
        secret: inbox.secret,
      });
      setSubs((all) => [
        ...all.filter((s) => s.id !== result.id),
        {
          id: result.id,
          name: selected,
          arguments: parsed,
          url: inbox.url,
          refreshBefore: result.refreshBefore,
        },
      ]);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [server, inbox, args, selected]);

  const unsubscribe = useCallback(
    async (sub: ActiveSubscription) => {
      const session = sessionOf(server);
      if (!session) return;
      try {
        await unsubscribeEvent(session, sub);
        setSubs((all) => all.filter((s) => s.id !== sub.id));
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [server]
  );

  const current = events.find((e) => e.name === selected);

  return (
    <div className="h-full overflow-auto p-4 space-y-6 text-sm">
      {error && <div className="text-red-600">{error}</div>}
      <section className="space-y-2">
        <h2 className="font-semibold">Events</h2>
        {events.length === 0 && (
          <p className="text-muted-foreground">No events.</p>
        )}
        <ul className="space-y-1">
          {events.map((e) => (
            <li key={e.name}>
              <button
                type="button"
                className={`text-left ${e.name === selected ? "font-semibold" : ""}`}
                onClick={() => setSelected(e.name)}
              >
                {e.name}
              </button>
              {e.description && (
                <span className="text-muted-foreground"> {e.description}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {current && (
        <section className="space-y-2">
          <h2 className="font-semibold">Subscribe to {current.name}</h2>
          <pre className="text-xs bg-muted p-2 rounded overflow-auto">
            {JSON.stringify(current.inputSchema, null, 2)}
          </pre>
          <label className="block">
            Arguments (JSON)
            <textarea
              aria-label="Arguments"
              className="block w-full font-mono text-xs border rounded p-2 mt-1"
              rows={4}
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Callback: {inbox?.url ?? "creating inbox..."}
          </p>
          <Button onClick={subscribe} disabled={!inbox || !ready}>
            Subscribe
          </Button>
        </section>
      )}

      {subs.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">Subscriptions</h2>
          {subs.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <code className="text-xs">{s.name}</code>
              <code className="text-xs">{JSON.stringify(s.arguments)}</code>
              <span className="text-xs text-muted-foreground">
                refresh before {s.refreshBefore ?? "never"}
              </span>
              <Button variant="outline" onClick={() => unsubscribe(s)}>
                Unsubscribe
              </Button>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">Webhook inbox ({deliveries.length})</h2>
        {deliveries.map((d, i) => (
          <div key={`${d.webhookId}-${i}`} className="border rounded p-2">
            <div className="text-xs text-muted-foreground">
              {d.receivedAt} · {d.kind} ·{" "}
              {d.verified ? "signature ok" : "INVALID signature"} · webhook-id{" "}
              {d.webhookId}
            </div>
            <pre className="text-xs overflow-auto">
              {JSON.stringify(d.body, null, 2)}
            </pre>
          </div>
        ))}
      </section>
    </div>
  );
}
