import {
  pollChecks,
  type InspectorPollResponse,
} from "@/client/hooks/useEventSubscriptions";

/** Props of {@link PollPanel}. */
export interface PollPanelProps {
  polls: InspectorPollResponse[];
}

/** Per-response view of `events/poll` with its checks, newest first. */
export function PollPanel({ polls }: PollPanelProps) {
  if (polls.length === 0) return null;
  let sawCursor = false;
  const rows = polls.map((p) => {
    const checks = pollChecks(p.result, sawCursor);
    if (p.result.cursor !== null) sawCursor = true;
    return { p, checks };
  });
  return (
    <ul className="space-y-2" data-testid="events-poll-panel">
      {rows.reverse().map(({ p, checks }) => (
        <li key={p.at} className="rounded border border-border p-2 text-xs">
          <div className="flex flex-wrap gap-2 font-mono">
            <span>{new Date(p.at).toLocaleTimeString()}</span>
            <span>{p.name}</span>
            <span>events {p.result.events.length}</span>
            <span>cursor {p.result.cursor ?? "null"}</span>
            <span>truncated {String(p.result.truncated)}</span>
            <span>hasMore {String(p.result.hasMore)}</span>
            <span>nextPollMs {p.result.nextPollMs ?? "—"}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {checks.map((c) => (
              <span
                key={c.id}
                title={c.detail}
                className={c.ok ? "text-green-600" : "text-red-600"}
              >
                {c.id} {c.ok ? "✓" : "✗"}
              </span>
            ))}
          </div>
          {p.result.events.length > 0 && (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono">
              {JSON.stringify(p.result.events, null, 2)}
            </pre>
          )}
        </li>
      ))}
    </ul>
  );
}
