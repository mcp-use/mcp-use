/**
 * SSE reader for an Inspector Events inbox (D71): entries after the client's
 * last `seq` from the inbox log, then live, woken by the storage `signal`
 * when the store has one, else by tail polling. Any replica can serve it.
 */
import { inboxWakeChannel, type StorageEventsInbox } from "./inbox-store.js";

/** Tail-poll interval when the store has no signal, in milliseconds. */
export const INBOX_TAIL_POLL_MS = 1_000;
/** Interval between SSE keep-alive comments, in milliseconds. */
export const INBOX_KEEPALIVE_MS = 15_000;

/** Options for {@link inboxSseResponse}. */
export interface InboxSseOptions {
  /** Last seq the client has; `null` streams from the oldest kept entry. */
  after: number | null;
  /** Aborts the stream (the browser disconnected). */
  signal: AbortSignal;
  /** Tail-poll interval; default {@link INBOX_TAIL_POLL_MS}. */
  pollMs?: number;
}

/**
 * Streams an inbox as `text/event-stream`. Each delivery is one
 * `event: delivery` frame whose `id:` is its seq, so `Last-Event-ID` resumes.
 *
 * @param inbox - The inbox store.
 * @param id - The inbox id (already authorized).
 * @param options - Resume position and abort signal.
 */
export function inboxSseResponse(
  inbox: StorageEventsInbox,
  id: string,
  options: InboxSseOptions
): Response {
  const encoder = new TextEncoder();
  const pollMs = options.pollMs ?? INBOX_TAIL_POLL_MS;
  let cursor = options.after;
  let closed = false;
  let wake: (() => void) | undefined;
  let pending = false;
  const onSignal = () => {
    if (wake) wake();
    else pending = true;
  };
  let unsubscribe: (() => Promise<void>) | undefined;

  const waitForWake = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        wake?.();
        void unsubscribe?.().catch(() => undefined);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      options.signal.addEventListener("abort", close, { once: true });
      if (inbox.storage.signal) {
        try {
          unsubscribe = await inbox.storage.signal.subscribe(
            inboxWakeChannel(id),
            onSignal
          );
        } catch {
          unsubscribe = undefined; // fall back to tail polling
        }
      }
      send(`retry: 2000\n\n`);
      let lastWrite = Date.now();
      while (!closed) {
        try {
          for (;;) {
            const page = await inbox.read(id, cursor, 100);
            for (const entry of page.entries) {
              send(
                `id: ${entry.seq}\nevent: delivery\ndata: ${JSON.stringify(entry)}\n\n`
              );
              cursor = entry.seq;
              lastWrite = Date.now();
            }
            if (page.entries.length < 100) break;
          }
        } catch (error) {
          send(
            `event: error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : String(error) })}\n\n`
          );
        }
        if (Date.now() - lastWrite >= INBOX_KEEPALIVE_MS) {
          send(`: keep-alive\n\n`);
          lastWrite = Date.now();
        }
        if (pending) {
          pending = false;
          continue;
        }
        await waitForWake(unsubscribe ? INBOX_KEEPALIVE_MS : pollMs);
        wake = undefined;
      }
    },
    cancel() {
      closed = true;
      wake?.();
      void unsubscribe?.().catch(() => undefined);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
