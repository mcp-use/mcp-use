import type { EventsInboxDelivery } from "@/client/utils/events-inbox-provider";

/** Props of {@link Inbox}. */
export interface InboxProps {
  deliveries: EventsInboxDelivery[];
  /** Resubscribe from a `gap` envelope's cursor. */
  onResubscribeFromCursor?: (cursor: string | null) => void;
  /** Forward an event delivery to the Chat tab. */
  onRunInChat?: (delivery: EventsInboxDelivery) => void;
}

function parse(body: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Live webhook deliveries with their checks, newest first. */
export function Inbox({
  deliveries,
  onResubscribeFromCursor,
  onRunInChat,
}: InboxProps) {
  if (deliveries.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="events-inbox-empty"
      >
        No deliveries yet.
      </p>
    );
  }
  return (
    <ul className="space-y-2" data-testid="events-inbox">
      {[...deliveries].reverse().map((d) => {
        const failed = d.checks.filter((c) => !c.ok && c.level !== "INFO");
        const body = parse(d.body);
        return (
          <li
            key={d.seq}
            className="rounded border border-border p-2 text-xs"
            data-testid="events-delivery"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={failed.length ? "text-red-500" : "text-green-600"}
              >
                {failed.length ? "✗" : d.kind === "gap" ? "◆" : "✓"}
              </span>
              <span className="font-mono">
                {new Date(d.receivedAt).toLocaleTimeString()}
              </span>
              <span className="font-semibold">{d.kind}</span>
              {typeof body?.name === "string" && <span>{body.name}</span>}
              <span className="text-muted-foreground">
                → {d.response.status}
                {d.response.faultApplied
                  ? ` (fault ${d.response.faultApplied})`
                  : ""}
              </span>
              {d.kind === "gap" && onResubscribeFromCursor && (
                <button
                  type="button"
                  className="underline"
                  onClick={() =>
                    onResubscribeFromCursor(
                      (body?.cursor as string | null | undefined) ?? null
                    )
                  }
                >
                  Resubscribe from cursor
                </button>
              )}
              {d.kind === "event" && onRunInChat && (
                <button
                  type="button"
                  className="underline"
                  onClick={() => onRunInChat(d)}
                >
                  Run in Chat
                </button>
              )}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {d.checks.map((c) => (
                <span
                  key={c.id}
                  title={c.detail}
                  className={`rounded px-1 ${
                    c.ok
                      ? "bg-green-500/10 text-green-700 dark:text-green-400"
                      : c.level === "INFO"
                        ? "bg-muted text-muted-foreground"
                        : "bg-red-500/10 text-red-600"
                  }`}
                >
                  {c.id} {c.ok ? "✓" : "✗"}
                </span>
              ))}
            </div>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono">
              {body ? JSON.stringify(body, null, 2) : d.body}
            </pre>
          </li>
        );
      })}
    </ul>
  );
}
