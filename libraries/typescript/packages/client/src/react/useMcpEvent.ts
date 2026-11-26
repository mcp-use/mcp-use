import { useEffect, useRef, useState } from "react";

import { pollEvents, type EventEnvelope } from "../events.js";
import type { UseMcpResult } from "./types.js";

/** Options for {@link useMcpEvent}. */
export interface UseMcpEventOptions {
  /** Subscription arguments (filters). */
  arguments?: Record<string, unknown>;
  /** Pause polling when false. Default true. */
  enabled?: boolean;
  /** Keep at most this many events, newest last. Default 100. */
  maxEvents?: number;
  /** Lower bound on the delay between polls, in ms. Default 1000. */
  minIntervalMs?: number;
}

/** Result of {@link useMcpEvent}. */
export interface UseMcpEventResult<T> {
  /** Events received since the hook started, oldest first. */
  events: EventEnvelope<T>[];
  /** `idle` until the connection is ready, then `polling`; `error` after a failed poll (retried). */
  state: "idle" | "polling" | "error";
  error: Error | null;
  /** A poll reported a gap (events may have been missed). */
  truncated: boolean;
}

/**
 * Follow an MCP Event by polling (`events/poll`, official extension). Starts
 * from now once the connection is ready and appends new events as they
 * arrive.
 *
 * @example
 * ```tsx
 * const mcp = useMcp({ url: "http://localhost:3000/mcp" });
 * const { events } = useMcpEvent(mcp, "message.created", {
 *   arguments: { channel: "general" },
 * });
 * ```
 *
 * @param mcp - The `useMcp` result (or a provider server).
 * @param name - Event name.
 * @param options - Arguments and polling options.
 */
export function useMcpEvent<T = unknown>(
  mcp: Pick<UseMcpResult, "client" | "state">,
  name: string,
  options: UseMcpEventOptions = {}
): UseMcpEventResult<T> {
  const [events, setEvents] = useState<EventEnvelope<T>[]>([]);
  const [state, setState] = useState<UseMcpEventResult<T>["state"]>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [truncated, setTruncated] = useState(false);
  const argsKey = JSON.stringify(options.arguments ?? {});
  const keep = useRef(options.maxEvents ?? 100);
  keep.current = options.maxEvents ?? 100;
  const enabled = options.enabled ?? true;
  const floor = options.minIntervalMs ?? 1000;

  useEffect(() => {
    const client = mcp.client;
    if (!enabled || mcp.state !== "ready" || client === null) {
      setState("idle");
      return;
    }
    const session = Object.values(client.getAllActiveSessions())[0];
    if (session === undefined) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cursor: string | null = null;
    const args = JSON.parse(argsKey) as Record<string, unknown>;
    const tick = async () => {
      let delay = floor;
      try {
        const page = await pollEvents<T>(session, {
          name,
          arguments: args,
          cursor,
        });
        if (stopped) return;
        cursor = page.cursor;
        if (page.truncated) setTruncated(true);
        if (page.events.length > 0)
          setEvents((prev) =>
            [...prev, ...page.events].slice(-Math.max(keep.current, 1))
          );
        setState("polling");
        setError(null);
        delay = page.hasMore ? 0 : Math.max(page.nextPollMs, floor);
      } catch (err) {
        if (stopped) return;
        setState("error");
        setError(err instanceof Error ? err : new Error(String(err)));
        delay = Math.max(floor, 5000);
      }
      if (!stopped) timer = setTimeout(() => void tick(), delay);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [mcp.client, mcp.state, name, argsKey, enabled, floor]);

  return { events, state, error, truncated };
}
