import type { McpServer } from "@mcp-use/client/react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/client/components/ui/button";
import { useEventsInbox } from "@/client/hooks/useEventsInbox";
import {
  supportsEvents,
  useEventSubscriptions,
  type InspectorEventDescriptor,
} from "@/client/hooks/useEventSubscriptions";
import {
  HttpEventsInboxProvider,
  type EventsInboxDelivery,
  type EventsInboxProfile,
  type EventsInboxProvider,
} from "@/client/utils/events-inbox-provider";
import { Faults } from "./events/Faults";
import { Inbox } from "./events/Inbox";
import { PollPanel } from "./events/PollPanel";

/** Props of {@link EventsTab}. */
export interface EventsTabProps {
  /** The connected server. */
  server: McpServer;
  /** Inbox backend; default the Inspector server's routes. */
  inboxProvider?: EventsInboxProvider;
  /** Prefix the Inspector server is mounted under, for the default provider. */
  basePath?: string;
  /** Forwards an event delivery to the Chat tab, wrapped as untrusted data. */
  onRunInChat?: (text: string) => void;
}

const PROFILES: Array<{ value: EventsInboxProfile; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "sep-3415", label: "SEP-3415" },
  { value: "openai", label: "ChatGPT emulation" },
];

declare global {
  interface Window {
    __MCP_USE_DEV_TOKEN__?: string;
  }
}

function parseJsonObject(text: string): Record<string, unknown> | string {
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : "arguments must be a JSON object";
  } catch (e) {
    return (e as Error).message;
  }
}

/**
 * The Events tab (§10.3): catalog, client profile, webhook subscribe with the
 * Inspector inbox as the receiver, live deliveries with checks, fault presets
 * and the poll panel.
 *
 * TODO(events): push panel (`StreamPanel`), server subscriptions panel
 * (admin routes), conformance panel, lint, legacy-`initialize` ChatGPT
 * emulation, auto-refresh timers and "Expose inbox" are not built yet.
 */
export function EventsTab({
  server,
  inboxProvider,
  basePath = "",
  onRunInChat,
}: EventsTabProps) {
  const provider = useMemo(
    () =>
      inboxProvider ??
      new HttpEventsInboxProvider(
        basePath,
        typeof window !== "undefined" ? window.__MCP_USE_DEV_TOKEN__ : undefined
      ),
    [inboxProvider, basePath]
  );
  const [profile, setProfile] = useState<EventsInboxProfile>("auto");
  const inbox = useEventsInbox(provider, profile);
  const subs = useEventSubscriptions(server);
  const [selected, setSelected] = useState<string | null>(null);
  const [argsText, setArgsText] = useState("{}");
  const [cursor, setCursor] = useState("");
  const [maxAgeMs, setMaxAgeMs] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const event: InspectorEventDescriptor | undefined =
    subs.events.find((e) => e.name === selected) ?? subs.events[0];

  // A `terminated` delivery ends its subscription row.
  useEffect(() => {
    const last = inbox.deliveries[inbox.deliveries.length - 1];
    const subId = last?.headers["x-mcp-subscription-id"];
    if (last?.kind === "terminated" && subId) subs.markEnded(subId);
  }, [inbox.deliveries, subs.markEnded]);

  if (!supportsEvents(server)) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        This server does not advertise MCP Events.
      </div>
    );
  }

  const readForm = () => {
    const args = parseJsonObject(argsText);
    if (typeof args === "string") {
      setFormError(args);
      return undefined;
    }
    setFormError(null);
    const age = maxAgeMs.trim() ? Number(maxAgeMs) : undefined;
    return {
      name: event!.name,
      arguments: args,
      cursor: cursor.trim() ? cursor.trim() : undefined,
      maxAgeMs: Number.isFinite(age) ? age : undefined,
    };
  };

  const subscribeWebhook = async (fromCursor?: string | null) => {
    const form = readForm();
    if (!form) return;
    const box = await inbox.ensure();
    const sub = await subs.subscribe({
      ...form,
      cursor: fromCursor !== undefined ? fromCursor : form.cursor,
      url: box.callbackUrl,
      secret: box.secret,
    });
    if (sub?.cursor) setCursor(sub.cursor);
  };

  const pollOnce = async () => {
    const form = readForm();
    if (!form) return;
    const res = await subs.poll(form);
    if (res?.result.cursor) setCursor(res.result.cursor);
  };

  const runInChat = onRunInChat
    ? (d: EventsInboxDelivery) =>
        onRunInChat(`<untrusted-mcp-event>\n${d.body}\n</untrusted-mcp-event>`)
    : undefined;

  return (
    <div className="flex h-full min-h-0" data-testid="events-tab">
      <aside className="w-72 shrink-0 space-y-4 overflow-auto border-r border-border p-3 text-sm">
        <fieldset className="space-y-1">
          <legend className="font-semibold">Client profile</legend>
          {PROFILES.map((p) => (
            <label key={p.value} className="flex items-center gap-2">
              <input
                type="radio"
                name="events-profile"
                checked={profile === p.value}
                onChange={() => {
                  setProfile(p.value);
                  if (inbox.inbox) void inbox.setProfile(p.value);
                }}
              />
              {p.label}
            </label>
          ))}
        </fieldset>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold">Events</span>
            <button
              type="button"
              className="text-xs underline"
              onClick={() => void subs.refreshCatalog()}
            >
              {subs.loading ? "Loading…" : "Refresh"}
            </button>
          </div>
          <ul data-testid="events-catalog">
            {subs.events.map((e) => (
              <li key={e.name}>
                <button
                  type="button"
                  className={`w-full rounded px-2 py-1 text-left ${
                    e.name === event?.name ? "bg-muted" : ""
                  }`}
                  onClick={() => setSelected(e.name)}
                >
                  <span className="font-mono">{e.name}</span>{" "}
                  <span className="text-xs text-muted-foreground">
                    {e.delivery.join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <span className="font-semibold">My subscriptions</span>
          <ul
            className="mt-1 space-y-1 text-xs"
            data-testid="events-subscriptions"
          >
            {subs.subscriptions.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-1"
              >
                <span className="truncate font-mono" title={s.id}>
                  {s.id.slice(0, 10)}… {s.name} {s.status}
                </span>
                {s.status === "active" && (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void subs.unsubscribe(s)}
                  >
                    Unsubscribe
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <section className="min-w-0 flex-1 space-y-4 overflow-auto p-4">
        {event ? (
          <>
            <header>
              <h2 className="font-mono text-base font-semibold">
                {event.name}
              </h2>
              {event.description && (
                <p className="text-sm text-muted-foreground">
                  {event.description}
                </p>
              )}
            </header>
            <div className="space-y-2 rounded border border-border p-3 text-sm">
              <label className="block">
                Arguments (JSON, per inputSchema)
                <textarea
                  aria-label="Event arguments"
                  className="mt-1 w-full rounded border border-border bg-background p-2 font-mono text-xs"
                  rows={3}
                  value={argsText}
                  onChange={(e) => setArgsText(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-1">
                  Cursor
                  <input
                    aria-label="Cursor"
                    className="rounded border border-border bg-background px-1 font-mono text-xs"
                    value={cursor}
                    onChange={(e) => setCursor(e.target.value)}
                  />
                </label>
                <label className="flex items-center gap-1">
                  maxAgeMs
                  <input
                    aria-label="maxAgeMs"
                    inputMode="numeric"
                    className="w-24 rounded border border-border bg-background px-1 text-xs"
                    value={maxAgeMs}
                    onChange={(e) => setMaxAgeMs(e.target.value)}
                  />
                </label>
              </div>
              {formError && <p className="text-xs text-red-600">{formError}</p>}
              <div className="flex flex-wrap gap-2">
                {event.delivery.includes("webhook") && (
                  <Button size="sm" onClick={() => void subscribeWebhook()}>
                    Subscribe (webhook)
                  </Button>
                )}
                {event.delivery.includes("poll") && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void pollOnce()}
                  >
                    Poll once
                  </Button>
                )}
              </div>
              {inbox.inbox && (
                <p className="text-xs text-muted-foreground">
                  Callback{" "}
                  <span className="font-mono">{inbox.inbox.callbackUrl}</span> ·
                  secret <span className="font-mono">whsec_••••</span>
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {subs.loading ? "Loading events…" : "The server lists no events."}
          </p>
        )}
        {(subs.error || inbox.error) && (
          <p className="text-sm text-red-600" role="alert">
            {subs.error ?? inbox.error}
          </p>
        )}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Deliveries (live)</h3>
            <Faults
              fault={inbox.inbox?.fault ?? null}
              onChange={(f) => void inbox.setFault(f)}
            />
          </div>
          <Inbox
            deliveries={inbox.deliveries}
            onResubscribeFromCursor={(c) => void subscribeWebhook(c)}
            onRunInChat={runInChat}
          />
        </div>
        <PollPanel polls={subs.polls} />
      </section>
    </div>
  );
}
