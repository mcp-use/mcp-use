import type { McpServer, Tool } from "@mcp-use/client/react";
import {
  listEvents,
  pollEvents,
  subscribeEvent,
  unsubscribeEvent,
  type EventEnvelope,
  type EventInfo,
  type EventsRequester,
} from "@mcp-use/client/events";
import {
  BellRing,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Badge } from "@/client/components/ui/badge";
import { Button, buttonToolbarClass } from "@/client/components/ui/button";
import { NotFound } from "@/client/components/ui/not-found";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/client/components/ui/resizable";
import { Spinner } from "@/client/components/ui/spinner";
import { Textarea } from "@/client/components/ui/textarea";
import { useInspector } from "@/client/context/InspectorContext";
import { cn } from "@/client/lib/utils";
import { inspectorApi } from "@/client/utils/basePath";
import { InspectorScrollArea, ListItem, SearchTabHeader } from "./shared";
import { JSONDisplay } from "./shared/JSONDisplay";
import { ToolInputForm } from "./tools/ToolInputForm";
import {
  coerceExecutionArgByType,
  coerceTextInputValueByType,
  getToolPropertyType,
} from "./tools/schema-utils";

/** JSON-RPC code for a refused subscription (SEP-3415 `forbidden`). */
const FORBIDDEN = -32024;

/** A subscribe/poll failure, keeping the JSON-RPC code and data when present. */
interface TabError {
  message: string;
  code?: number;
  data?: unknown;
}

function toTabError(e: unknown): TabError {
  const err = e as { message?: string; code?: unknown; data?: unknown };
  return {
    message: String(err?.message ?? e),
    code: typeof err?.code === "number" ? err.code : undefined,
    data: err?.data,
  };
}

/** Webhook refused because the server needs an authenticated principal. */
function needsSignIn(error: TabError | null): boolean {
  if (!error || error.code !== FORBIDDEN) return false;
  const reason = (error.data as { reason?: unknown } | undefined)?.reason;
  return reason === "unauthenticated" || reason === "principal_required";
}

import { isLocalhostServerUrl } from "@/client/utils/servers";
export {
  EVENTS_UNSUPPORTED_MESSAGE,
  supportsEvents,
} from "@/client/utils/eventsProtocol";

type DeliveryMode = "webhook" | "poll";

interface InboxDelivery {
  receivedAt: string;
  webhookId: string | null;
  subscriptionId: string | null;
  verified: boolean;
  kind: "verification" | "event";
  headers?: Record<string, string>;
  body: unknown;
}

/** One delivery shown under a subscription (webhook POST or poll result). */
interface Delivery {
  key: string;
  receivedAt: string;
  label: string;
  verified?: boolean;
  headers?: Record<string, string>;
  body: unknown;
}

interface OwnSubscription {
  key: string;
  /** Server id (webhook) or null (poll). */
  id: string | null;
  mode: DeliveryMode;
  name: string;
  arguments: Record<string, unknown>;
  createdAt: string;
  refreshBefore: string | null;
  cursor: string | null;
  polled: Delivery[];
  /** The last poll reported `truncated`: events may have been missed. */
  truncated?: boolean;
  error?: string;
}

/** A unique local key; `crypto.randomUUID` needs a secure context. */
function localKey(): string {
  return typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function sessionOf(server: McpServer): EventsRequester | undefined {
  const client = server.client;
  const name = client?.activeSessions[0];
  const session = name ? client?.getSession(name) : null;
  return session ?? undefined;
}

function time(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}

/** Toggle text buttons, as in the Tools response header. */
function TextToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {options.map((o, i) => (
        <span key={o.value} className="flex items-center gap-2">
          {i > 0 && <span className="text-xs text-zinc-400">|</span>}
          <button
            type="button"
            disabled={o.disabled}
            data-testid={`events-toggle-${o.value}`}
            onClick={() => onChange(o.value)}
            className={cn(
              "text-xs font-medium disabled:opacity-40",
              value === o.value
                ? "text-black dark:text-white"
                : "text-zinc-500 dark:text-zinc-400"
            )}
          >
            {o.label}
          </button>
        </span>
      ))}
    </div>
  );
}

function DeliveryRow({ delivery }: { delivery: Delivery }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b last:border-b-0 border-gray-200 dark:border-zinc-700">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        data-testid="events-delivery-row"
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-zinc-800/50"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="font-mono text-xs truncate">{delivery.label}</span>
        {delivery.verified !== undefined &&
          (delivery.verified ? (
            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 shrink-0">
              <ShieldCheck className="h-3 w-3" /> signature ok
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 shrink-0">
              <ShieldAlert className="h-3 w-3" /> invalid signature
            </span>
          ))}
        <span className="ml-auto text-xs text-gray-500 dark:text-gray-400 shrink-0">
          {time(delivery.receivedAt)}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          {delivery.headers && Object.keys(delivery.headers).length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Headers
              </div>
              <div className="bg-gray-50 dark:bg-zinc-900 rounded-lg p-3 font-mono text-xs space-y-0.5">
                {Object.entries(delivery.headers).map(([k, v]) => (
                  <div key={k} className="break-all">
                    <span className="text-gray-500 dark:text-gray-400">
                      {k}:
                    </span>{" "}
                    {v}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Body
            </div>
            <div className="bg-gray-50 dark:bg-zinc-900 rounded-lg p-3">
              <JSONDisplay data={delivery.body} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface StoredInbox {
  id: string;
  secret: string;
  path: string;
  subs: OwnSubscription[];
}

/** Read the persisted inbox for a server; undefined when absent or invalid. */
function readStoredInbox(key: string): StoredInbox | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const v = JSON.parse(raw) as Partial<StoredInbox>;
    if (
      typeof v.id !== "string" ||
      typeof v.secret !== "string" ||
      typeof v.path !== "string"
    )
      return undefined;
    return {
      id: v.id,
      secret: v.secret,
      path: v.path,
      subs: Array.isArray(v.subs)
        ? v.subs.filter(
            (s) =>
              s &&
              s.mode === "webhook" &&
              typeof s.id === "string" &&
              typeof s.name === "string"
          )
        : [],
    };
  } catch {
    return undefined;
  }
}

function writeStoredInbox(key: string, value: StoredInbox): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota): the inbox lasts this page only.
  }
}

/**
 * The Events tab: the server's events on the left (like the Tools list), the
 * selected event's subscribe form top right, and this Inspector's
 * subscriptions with their deliveries bottom right.
 */
export function EventsTab({ server }: { server: McpServer }) {
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [inputMode, setInputMode] = useState<"form" | "json">("form");
  const [formArgs, setFormArgs] = useState<Record<string, unknown>>({});
  const [jsonArgs, setJsonArgs] = useState("{}");
  const [mode, setMode] = useState<DeliveryMode>("webhook");
  const [schemaView, setSchemaView] = useState<"input" | "payload">("input");
  const [inbox, setInbox] = useState<{
    id: string;
    secret: string;
    url: string;
  }>();
  const [inboxDeliveries, setInboxDeliveries] = useState<InboxDelivery[]>([]);
  const [subs, setSubs] = useState<OwnSubscription[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setErrorState] = useState<TabError | null>(null);
  const setError = useCallback(
    (e: TabError | string | null) =>
      setErrorState(typeof e === "string" ? { message: e } : e),
    []
  );
  const { setActiveTab } = useInspector();
  const navigate = useNavigate();
  const location = useLocation();
  const openConnectionSettings = () => {
    setActiveTab("connection-settings");
    const params = new URLSearchParams(location.search);
    params.set("tab", "connection-settings");
    navigate(`/?${params.toString()}`, { replace: true });
  };
  const ready = server.state === "ready";

  const refreshEvents = useCallback(async () => {
    const session = sessionOf(server);
    if (!session) return;
    setIsRefreshing(true);
    try {
      setEvents(await listEvents(session));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsRefreshing(false);
    }
  }, [server]);

  useEffect(() => {
    if (ready) void refreshEvents();
  }, [ready, refreshEvents]);

  // Reuse this server's webhook inbox across page loads (kept in
  // localStorage), so webhook subscriptions made earlier stay visible and can
  // be unsubscribed. Inboxes live in the Inspector server's memory: when the
  // stored one is gone, start a new one.
  const storageKey = `mcp-use:events-inbox:${server.id}`;
  const [restored, setRestored] = useState(false);
  const [inboxPath, setInboxPath] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    setRestored(false);
    const stored = readStoredInbox(storageKey);
    const toUrl = (path: string) => `${window.location.origin}${path}`;
    const reuse = stored
      ? fetch(inspectorApi(`events/inboxes/${stored.id}`)).then((r) =>
          r.ok ? stored : undefined
        )
      : Promise.resolve(undefined);
    reuse
      .catch(() => undefined)
      .then(async (found) => {
        if (found) return { inbox: found, subs: found.subs };
        const r = await fetch(inspectorApi("events/inboxes"), {
          method: "POST",
        });
        const b = (await r.json()) as {
          id: string;
          secret: string;
          path: string;
        };
        return {
          inbox: { id: b.id, secret: b.secret, path: b.path, subs: [] },
          subs: [] as OwnSubscription[],
        };
      })
      .then(({ inbox: next, subs: saved }) => {
        if (cancelled) return;
        setInbox({ id: next.id, secret: next.secret, url: toUrl(next.path) });
        setInboxPath(next.path);
        setSubs((all) => [
          ...all,
          ...saved.filter((s) => !all.some((a) => a.key === s.key)),
        ]);
        setRestored(true);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(`inbox: ${e.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey, setError]);

  // Persist the inbox and its webhook subscriptions for the next page load.
  useEffect(() => {
    if (!inbox || !inboxPath || !restored) return;
    writeStoredInbox(storageKey, {
      id: inbox.id,
      secret: inbox.secret,
      path: inboxPath,
      subs: subs
        .filter((s) => s.mode === "webhook")
        .map((s) => ({ ...s, polled: [], error: undefined })),
    });
  }, [storageKey, inbox, inboxPath, restored, subs]);

  // Fetch the inbox only while a webhook subscription exists and the page is
  // visible.
  const hasWebhookSub = subs.some((s) => s.mode === "webhook");
  useEffect(() => {
    if (!inbox || !hasWebhookSub) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      fetch(inspectorApi(`events/inboxes/${inbox.id}`))
        .then((r) => r.json())
        .then((b: { deliveries?: InboxDelivery[] }) =>
          setInboxDeliveries(b.deliveries ?? [])
        )
        .catch(() => undefined);
    }, 1500);
    return () => clearInterval(timer);
  }, [inbox, hasWebhookSub]);

  // Poll subscriptions: one events/poll per subscription every few seconds.
  // At most one request in flight per subscription, so a slow response can
  // never land after a newer one and move the cursor backwards.
  const subsRef = useRef(subs);
  subsRef.current = subs;
  const inFlight = useRef(new Set<string>());
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => {
      const session = sessionOf(server);
      if (!session) return;
      for (const sub of subsRef.current) {
        if (sub.mode !== "poll" || inFlight.current.has(sub.key)) continue;
        inFlight.current.add(sub.key);
        pollEvents(session, {
          name: sub.name,
          arguments: sub.arguments,
          cursor: sub.cursor,
        })
          .then((result) => {
            const received = new Date().toISOString();
            const fresh: Delivery[] = result.events.map(
              (ev: EventEnvelope) => ({
                key: `${sub.key}-${ev.eventId}`,
                receivedAt: received,
                label: `${ev.name} · ${ev.eventId}`,
                body: ev,
              })
            );
            const newestFirst = [...fresh].reverse();
            setSubs((all) =>
              all.map((s) =>
                s.key === sub.key
                  ? {
                      ...s,
                      cursor: result.cursor,
                      error: undefined,
                      truncated: result.truncated,
                      polled: [...newestFirst, ...s.polled].slice(0, 200),
                    }
                  : s
              )
            );
          })
          .catch((e: Error) =>
            setSubs((all) =>
              all.map((s) =>
                s.key === sub.key ? { ...s, error: e.message } : s
              )
            )
          )
          .finally(() => inFlight.current.delete(sub.key));
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [server, ready]);

  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return events;
    return events.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.description ?? "").toLowerCase().includes(q)
    );
  }, [events, searchQuery]);

  const selected = events.find((e) => e.name === selectedName) ?? null;
  const supportsPoll = selected?.delivery.includes("poll") ?? false;
  const supportsWebhook = selected
    ? selected.delivery.length === 0 || selected.delivery.includes("webhook")
    : true;

  // Tool-shaped view of the event so ToolInputForm renders its arguments.
  const asTool = useMemo(
    () =>
      selected
        ? ({
            name: selected.name,
            description: selected.description,
            inputSchema: selected.inputSchema,
          } as unknown as Tool)
        : null,
    [selected]
  );

  const selectEvent = useCallback((event: EventInfo) => {
    setSelectedName(event.name);
    setFormArgs({});
    setJsonArgs("{}");
    setMode(
      event.delivery.length === 0 || event.delivery.includes("webhook")
        ? "webhook"
        : "poll"
    );
    setError(null);
  }, []);

  const rootSchema = useMemo(
    () => (selected?.inputSchema ?? {}) as Record<string, unknown>,
    [selected]
  );
  const properties = useMemo(
    () => (rootSchema.properties ?? {}) as Record<string, unknown>,
    [rootSchema]
  );

  const handleArgChange = useCallback(
    (key: string, value: string) => {
      const type = properties[key]
        ? getToolPropertyType(properties[key], rootSchema)
        : "string";
      setFormArgs((prev) => ({
        ...prev,
        [key]:
          type === "object" || type === "array" || type === "string"
            ? value
            : coerceTextInputValueByType(value, type),
      }));
    },
    [properties, rootSchema]
  );

  const formPayload = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(formArgs)) {
      if (raw === undefined || String(raw).trim() === "") continue;
      const type = properties[key]
        ? getToolPropertyType(properties[key], rootSchema)
        : "string";
      out[key] = coerceExecutionArgByType(raw, type);
    }
    return out;
  }, [formArgs, properties, rootSchema]);

  const switchInputMode = (next: "form" | "json") => {
    if (next === inputMode) return;
    if (next === "json") {
      setJsonArgs(JSON.stringify(formPayload, null, 2));
    } else {
      // Carry JSON edits back into the form; stay in JSON if they don't parse.
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonArgs || "{}");
      } catch (e) {
        setError(`Invalid JSON: ${(e as Error).message}`);
        return;
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        setError("Arguments must be a JSON object");
        return;
      }
      setFormArgs(
        Object.fromEntries(
          Object.entries(parsed).map(([k, v]) => [
            k,
            v !== null && typeof v === "object" ? JSON.stringify(v) : v,
          ])
        )
      );
      setError(null);
    }
    setInputMode(next);
  };

  const currentArgs = (): Record<string, unknown> => {
    if (inputMode === "form") return formPayload;
    const parsed = JSON.parse(jsonArgs || "{}") as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      throw new Error("Arguments must be a JSON object");
    return parsed as Record<string, unknown>;
  };

  const subscribe = useCallback(
    async (args: Record<string, unknown>, name: string, how: DeliveryMode) => {
      const session = sessionOf(server);
      if (!session) throw new Error("Not connected");
      const now = new Date().toISOString();
      if (how === "poll") {
        const first = await pollEvents(session, { name, arguments: args });
        const key = `poll-${localKey()}`;
        setSubs((all) => [
          {
            key,
            id: null,
            mode: "poll",
            name,
            arguments: args,
            createdAt: now,
            refreshBefore: null,
            cursor: first.cursor,
            polled: [],
          },
          ...all,
        ]);
        setExpanded((s) => new Set(s).add(key));
        return;
      }
      if (!inbox) throw new Error("Webhook inbox not ready");
      const result = await subscribeEvent(session, {
        name,
        arguments: args,
        url: inbox.url,
        secret: inbox.secret,
      });
      setSubs((all) => {
        const existing = all.find((s) => s.id === result.id);
        const next: OwnSubscription = {
          key: existing?.key ?? `webhook-${result.id}`,
          id: result.id,
          mode: "webhook",
          name,
          arguments: args,
          createdAt: existing?.createdAt ?? now,
          refreshBefore: result.refreshBefore,
          cursor: result.cursor,
          polled: [],
        };
        return [next, ...all.filter((s) => s.id !== result.id)];
      });
      setExpanded((s) => new Set(s).add(`webhook-${result.id}`));
    },
    [server, inbox]
  );

  const handleSubscribe = async () => {
    if (!selected) return;
    setError(null);
    setBusy(true);
    try {
      await subscribe(currentArgs(), selected.name, mode);
    } catch (e) {
      setError(toTabError(e));
    } finally {
      setBusy(false);
    }
  };

  const switchToPoll = async () => {
    if (!selected) return;
    setMode("poll");
    setError(null);
    setBusy(true);
    try {
      await subscribe(currentArgs(), selected.name, "poll");
    } catch (e) {
      setError(toTabError(e));
    } finally {
      setBusy(false);
    }
  };

  const unsubscribe = async (sub: OwnSubscription) => {
    setError(null);
    try {
      if (sub.mode === "webhook" && inbox) {
        const session = sessionOf(server);
        if (session)
          await unsubscribeEvent(session, {
            name: sub.name,
            arguments: sub.arguments,
            url: inbox.url,
          });
      }
      setSubs((all) => all.filter((s) => s.key !== sub.key));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const refresh = async (sub: OwnSubscription) => {
    setError(null);
    try {
      await subscribe(sub.arguments, sub.name, "webhook");
    } catch (e) {
      setError(toTabError(e));
    }
  };

  const deliveriesOf = (sub: OwnSubscription): Delivery[] =>
    sub.mode === "poll"
      ? sub.polled
      : inboxDeliveries
          .filter((d) => d.subscriptionId === sub.id)
          .map((d) => ({
            key: `${d.webhookId ?? "none"}-${d.receivedAt}`,
            receivedAt: d.receivedAt,
            label:
              d.kind === "verification"
                ? "verification"
                : `${(d.body as { name?: string } | null)?.name ?? "event"} · ${d.webhookId ?? ""}`,
            verified: d.verified,
            headers:
              d.headers ?? (d.webhookId ? { "webhook-id": d.webhookId } : {}),
            body: d.body,
          }));

  const toggle = (key: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const totalDeliveries = subs.reduce((n, s) => n + deliveriesOf(s).length, 0);

  const leftPanel = (
    <div className="flex h-full flex-col overflow-hidden border-r dark:border-zinc-700">
      <InspectorScrollArea>
        {(isScrolled) => (
          <>
            <SearchTabHeader
              isScrolled={isScrolled}
              title="Events"
              titleTestId="events-tab-title"
              icon={BellRing}
              count={filteredEvents.length}
              isSearchExpanded={isSearchExpanded}
              searchQuery={searchQuery}
              searchPlaceholder="Search events..."
              onSearchExpand={() => {
                setIsSearchExpanded(true);
                setTimeout(() => searchInputRef.current?.focus(), 0);
              }}
              onSearchChange={setSearchQuery}
              onSearchBlur={() => {
                if (!searchQuery.trim()) setIsSearchExpanded(false);
              }}
              searchInputRef={
                searchInputRef as React.RefObject<HTMLInputElement>
              }
              onRefresh={() => void refreshEvents()}
              isRefreshing={isRefreshing}
            />
            {filteredEvents.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
                <BellRing className="h-12 w-12 text-gray-400 dark:text-gray-600 mb-3" />
                <p className="text-gray-500 dark:text-gray-400">
                  No events available
                </p>
              </div>
            ) : (
              filteredEvents.map((event) => (
                <ListItem
                  key={event.name}
                  id={`event-${event.name}`}
                  data-testid={`event-item-${event.name}`}
                  isSelected={selectedName === event.name}
                  isFocused={false}
                  title={event.name}
                  description={event.description}
                  metadata={
                    <div className="flex items-center gap-1">
                      {event.delivery.map((d) => (
                        <Badge
                          key={d}
                          variant="outline"
                          className="text-xs border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-gray-400"
                        >
                          {d}
                        </Badge>
                      ))}
                    </div>
                  }
                  onClick={() => selectEvent(event)}
                />
              ))
            )}
          </>
        )}
      </InspectorScrollArea>
    </div>
  );

  const detailPanel = !selected ? (
    <div className="flex flex-col items-center justify-center h-full p-4 text-center">
      <p className="text-gray-500 dark:text-gray-400 mb-2">
        Select an event to get started
      </p>
      <p className="text-xs text-gray-400 dark:text-gray-500">
        Choose an event from the list to view its schemas and subscribe to it
      </p>
    </div>
  ) : (
    <div className="flex flex-col h-full">
      <div className="shrink-0 p-3 sm:p-5 pt-3 sm:pt-4 pb-2 sm:pb-2 sm:pr-4 flex items-center justify-between gap-2">
        <h3
          className="text-base sm:text-lg font-semibold truncate"
          data-testid="event-detail-title"
        >
          {selected.name}
        </h3>
        <div className="flex gap-3 shrink-0 items-center">
          <TextToggle
            value={mode}
            onChange={setMode}
            options={[
              {
                value: "webhook",
                label: "Webhook (Inspector inbox)",
                disabled: !supportsWebhook,
              },
              { value: "poll", label: "Poll", disabled: !supportsPoll },
            ]}
          />
          <Button
            data-testid="event-subscribe-button"
            size="sm"
            onClick={handleSubscribe}
            disabled={
              busy || !ready || (mode === "webhook" && inbox === undefined)
            }
            className={buttonToolbarClass}
          >
            {busy && <Spinner />}
            Subscribe
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 sm:px-5 pb-4 pr-3 space-y-6">
        {selected.description && (
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
            {selected.description}
          </p>
        )}
        {error && needsSignIn(error) ? (
          <div
            data-testid="events-auth-notice"
            className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-3 space-y-2"
          >
            <p className="font-medium">Webhook subscription needs sign-in</p>
            <p>
              This server only accepts webhook subscriptions from signed-in
              clients (MCP Events spec). The Inspector isn&apos;t signed in to
              this server.
            </p>
            <p>
              {supportsPoll
                ? "Use Poll delivery instead, or connect with authentication."
                : "Connect with authentication to use webhooks."}
            </p>
            <div className="flex flex-wrap gap-2">
              {supportsPoll && (
                <Button
                  data-testid="events-auth-use-poll"
                  size="sm"
                  onClick={switchToPoll}
                  disabled={busy || !ready}
                >
                  Use Poll
                </Button>
              )}
              <Button
                data-testid="events-auth-open-settings"
                size="sm"
                variant="outline"
                onClick={openConnectionSettings}
              >
                Connection settings
              </Button>
            </div>
          </div>
        ) : error ? (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg p-3 space-y-1">
            <p className="break-words">
              {error.code !== undefined && (
                <span className="font-mono mr-1">{error.code}</span>
              )}
              {error.message}
            </p>
            {error.data !== undefined && (
              <details className="text-xs">
                <summary className="cursor-pointer">Details</summary>
                <JSONDisplay data={error.data} />
              </details>
            )}
          </div>
        ) : null}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Arguments</h4>
            <TextToggle
              value={inputMode}
              onChange={switchInputMode}
              options={[
                { value: "form", label: "Form" },
                { value: "json", label: "JSON" },
              ]}
            />
          </div>
          {inputMode === "form" && asTool ? (
            <ToolInputForm
              selectedTool={asTool}
              toolArgs={formArgs}
              onArgChange={handleArgChange}
            />
          ) : (
            <Textarea
              aria-label="Arguments"
              data-testid="event-arguments-json"
              className="font-mono text-xs min-h-28"
              value={jsonArgs}
              onChange={(e) => setJsonArgs(e.target.value)}
            />
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 break-all">
            {mode === "webhook"
              ? `Callback: ${inbox?.url ?? "creating inbox..."}`
              : "The Inspector calls events/poll every 3 seconds."}
          </p>
          {mode === "webhook" &&
            inbox &&
            isLocalhostServerUrl(inbox.url) &&
            server.url !== undefined &&
            !isLocalhostServerUrl(server.url) && (
              <p
                className="text-xs text-amber-600 dark:text-amber-400"
                data-testid="events-callback-unreachable"
              >
                This callback is on localhost, so a remote server probably
                cannot reach it. Use poll delivery instead.
              </p>
            )}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Schema</h4>
            <TextToggle
              value={schemaView}
              onChange={setSchemaView}
              options={[
                { value: "input", label: "Input" },
                { value: "payload", label: "Payload" },
              ]}
            />
          </div>
          <div className="bg-gray-50 dark:bg-zinc-900 rounded-lg p-3">
            <JSONDisplay
              data={
                schemaView === "input"
                  ? selected.inputSchema
                  : selected.payloadSchema
              }
            />
          </div>
        </div>
      </div>
    </div>
  );

  const subscriptionsPanel = (
    <div className="relative flex flex-col h-full bg-white dark:bg-black">
      <div className="sticky top-0 z-40 flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-zinc-600 backdrop-blur-xs bg-white/50 dark:bg-black/50">
        <h3 className="text-sm font-medium">Subscriptions &amp; deliveries</h3>
        <Badge
          className="bg-zinc-500/20 text-zinc-600 dark:text-zinc-400 border-transparent"
          variant="outline"
        >
          {subs.length}
        </Badge>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {totalDeliveries} deliveries
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {subs.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <NotFound
              vertical
              noBorder
              message="No subscriptions yet. Subscribe to an event to see its deliveries here."
            />
          </div>
        ) : (
          subs.map((sub) => {
            const list = deliveriesOf(sub);
            const isOpen = expanded.has(sub.key);
            return (
              <div
                key={sub.key}
                data-testid="events-subscription"
                className="border-b border-gray-200 dark:border-zinc-700"
              >
                <div className="flex items-center gap-2 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggle(sub.key)}
                    className="flex flex-1 min-w-0 items-center gap-2 text-left"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="font-mono text-sm font-medium truncate">
                      {sub.name}
                    </span>
                    <Badge
                      variant="outline"
                      className="text-xs border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-gray-400"
                    >
                      {sub.mode}
                    </Badge>
                    <span className="font-mono text-xs text-gray-500 dark:text-gray-400 truncate">
                      {JSON.stringify(sub.arguments)}
                    </span>
                  </button>
                  <span className="hidden md:inline text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {list.length} deliveries
                    {sub.mode === "webhook" &&
                      ` · refresh before ${time(sub.refreshBefore)}`}
                  </span>
                  {sub.mode === "webhook" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className={buttonToolbarClass}
                      onClick={() => void refresh(sub)}
                      title="Refresh subscription"
                    >
                      <RefreshCw />
                      Refresh
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className={buttonToolbarClass}
                    onClick={() => void unsubscribe(sub)}
                    data-testid="events-unsubscribe-button"
                    title="Unsubscribe"
                  >
                    <Trash2 />
                    Unsubscribe
                  </Button>
                </div>
                {sub.truncated && (
                  <div className="px-4 pb-2 text-xs text-amber-600 dark:text-amber-400">
                    Some events may have been missed (truncated).
                  </div>
                )}
                {sub.error && (
                  <div className="px-4 pb-2 text-xs text-red-600 dark:text-red-400">
                    {sub.error}
                  </div>
                )}
                {isOpen && (
                  <div className="mx-4 mb-3 rounded-lg border border-gray-200 dark:border-zinc-700">
                    {sub.id && (
                      <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-zinc-700 font-mono break-all">
                        id {sub.id} · created {time(sub.createdAt)}
                      </div>
                    )}
                    {list.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">
                        Waiting for deliveries...
                      </div>
                    ) : (
                      list.map((d) => <DeliveryRow key={d.key} delivery={d} />)
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      <ResizablePanel
        id="events-left-panel"
        defaultSize="33%"
        collapsible
        className="flex flex-col h-full relative"
      >
        {leftPanel}
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize="67%">
        <ResizablePanelGroup orientation="vertical">
          <ResizablePanel defaultSize="50%" collapsible>
            {detailPanel}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="50%">
            {subscriptionsPanel}
          </ResizablePanel>
        </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
