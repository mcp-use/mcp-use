/**
 * STREAM and CURSOR checks over a raw SSE `events/stream` (§18.4).
 *
 * @packageDocumentation
 */

import {
  EVENTS_METHODS,
  EVENTS_NOTIFICATIONS,
  SUBSCRIPTION_ID_META_KEY,
  type EventDescriptor,
} from "../../wire.js";
import { nextId, sampleArgs, type Ctx } from "../context.js";
import { readExchange, sseMessages, type RpcMessage } from "../http.js";
import type { ConformanceCheck } from "../types.js";
import { poll } from "./poll.js";
import { check, fail, Outcome, pass, skip } from "./util.js";

interface Frame {
  at: number;
  m: RpcMessage;
}

/** An open push stream read frame by frame with deadlines. */
class Stream {
  private readonly it: AsyncGenerator<RpcMessage>;
  private pending: Promise<IteratorResult<RpcMessage>> | undefined;
  constructor(
    readonly id: string,
    body: ReadableStream<Uint8Array>,
    private readonly abort: AbortController
  ) {
    this.it = sseMessages(body);
  }
  /** The next frame, or `undefined` at the deadline or end of stream. */
  async next(timeoutMs: number): Promise<Frame | undefined> {
    this.pending ??= this.it.next();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const r = await Promise.race([
      this.pending,
      new Promise<"timeout">((res) => {
        timer = setTimeout(() => res("timeout"), Math.max(0, timeoutMs));
      }),
    ]);
    clearTimeout(timer);
    if (r === "timeout") return undefined;
    this.pending = undefined;
    return r.done ? undefined : { at: Date.now(), m: r.value };
  }
  close(): void {
    this.abort.abort();
    this.pending?.catch(() => undefined);
  }
}

async function pushEvent(c: Ctx): Promise<EventDescriptor> {
  const e = await c.pickEvent("push");
  if (!e) throw new Outcome(skip("no event offers push delivery"));
  return e;
}

async function open(c: Ctx, e: EventDescriptor): Promise<Stream> {
  const id = nextId();
  const abort = new AbortController();
  const { res } = await c.send(
    EVENTS_METHODS.stream,
    {
      name: e.name,
      arguments: sampleArgs(e.inputSchema),
      cursor: null,
      heartbeatMs: c.timing.heartbeatRequestMs,
    },
    {
      id,
      signal: abort.signal,
      headers: { accept: "text/event-stream, application/json" },
    }
  );
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream") || !res.body) {
    const x = await readExchange(res, id);
    throw new Outcome(
      fail(
        `events/stream did not open: HTTP ${x.status} ${JSON.stringify(x.response?.error ?? x.text ?? null)}`
      )
    );
  }
  return new Stream(id, res.body, abort);
}

async function withStream<T>(
  c: Ctx,
  fn: (s: Stream, e: EventDescriptor) => Promise<T>
): Promise<T> {
  const e = await pushEvent(c);
  const s = await open(c, e);
  try {
    return await fn(s, e);
  } finally {
    s.close();
  }
}

async function active(
  c: Ctx,
  s: Stream
): Promise<{ frame: Frame; grant: number }> {
  const f = await s.next(c.timing.requestMs);
  if (!f) throw new Outcome(fail("no frame within the request timeout"));
  if (f.m.method !== EVENTS_NOTIFICATIONS.active) {
    throw new Outcome(
      fail(`first frame is ${f.m.method ?? "a response"}, not active`)
    );
  }
  const grant = f.m.params?.heartbeatMs;
  if (!Number.isInteger(grant) || (grant as number) <= 0) {
    throw new Outcome(fail(`active.heartbeatMs ${JSON.stringify(grant)}`));
  }
  return { frame: f, grant: grant as number };
}

function recordEvent(c: Ctx, e: EventDescriptor, f: Frame): void {
  if (f.m.method === EVENTS_NOTIFICATIONS.event && f.m.params) {
    c.observed.push({ name: e.name, event: f.m.params });
  }
}

/** The push stream checks. */
export const STREAM_CHECKS: readonly ConformanceCheck[] = [
  check({
    id: "STREAM-ACTIVE-FIRST",
    profiles: ["sep-3415"],
    level: "MUST",
    cite: "events.mdx:715",
    run: (c) => withStream(c, async (s) => (await active(c, s), pass())),
  }),
  check({
    id: "STREAM-META-ID",
    profiles: ["sep-3415"],
    level: "MUST",
    cite: "events.mdx:720",
    run: (c) =>
      withStream(c, async (s, e) => {
        const { frame, grant } = await active(c, s);
        const until =
          Date.now() + Math.min(c.timing.streamObserveMs, grant * 2 + 500);
        let f: Frame | undefined = frame;
        let n = 0;
        while (f) {
          recordEvent(c, e, f);
          const meta = f.m.params?._meta as Record<string, unknown> | undefined;
          const got = f.m.method
            ? meta?.[SUBSCRIPTION_ID_META_KEY]
            : (f.m.result?._meta as Record<string, unknown> | undefined)?.[
                SUBSCRIPTION_ID_META_KEY
              ];
          if (got !== s.id)
            return fail(
              `${f.m.method ?? "result"} _meta subscription id ${JSON.stringify(got)} != ${s.id}`
            );
          n++;
          f = await s.next(until - Date.now());
        }
        return pass(`${n} frame(s)`);
      }),
  }),
  check({
    id: "STREAM-HEARTBEAT-DATA",
    profiles: ["sep-3415"],
    level: "MUST",
    cite: "events.mdx:725",
    run: (c) =>
      withStream(c, async (s, e) => {
        const { grant } = await active(c, s);
        if (grant * 1.1 > c.timing.streamObserveMs)
          return skip(`grant ${grant} ms exceeds the observation budget`);
        const until = Date.now() + grant * 1.1 + 1000;
        for (;;) {
          const f = await s.next(until - Date.now());
          if (!f)
            return fail(
              `no heartbeat frame within ${Math.round(grant * 1.1)} ms`
            );
          recordEvent(c, e, f);
          if (f.m.method === EVENTS_NOTIFICATIONS.heartbeat) {
            return f.m.params && "cursor" in f.m.params
              ? pass()
              : fail("heartbeat without cursor");
          }
        }
      }),
  }),
  check({
    id: "STREAM-HEARTBEAT-GRANT",
    profiles: ["sep-3415"],
    level: "MUST",
    cite: "events.mdx:725",
    run: (c) =>
      withStream(c, async (s, e) => {
        const { frame, grant } = await active(c, s);
        const window = Math.min(c.timing.streamObserveMs, grant * 3);
        if (window < grant * 1.1)
          return skip(`grant ${grant} ms exceeds the observation budget`);
        const limit = grant * 1.1 + 100;
        const until = Date.now() + window;
        let last = frame.at;
        for (;;) {
          const left = until - Date.now();
          if (left <= 0) return pass();
          const f = await s.next(Math.min(left, limit + 50));
          const now = f?.at ?? Date.now();
          if (now - last > limit && (f || left > limit)) {
            return fail(
              `silence of ${now - last} ms exceeds the ${grant} ms grant (+10 %)`
            );
          }
          if (!f) {
            if (until - Date.now() <= 0) return pass();
            continue;
          }
          recordEvent(c, e, f);
          last = f.at;
        }
      }),
  }),
  check({
    id: "STREAM-ERROR-PRE-OPEN",
    profiles: ["sep-3415"],
    level: "MUST",
    cite: "events.mdx:730",
    async run(c) {
      await pushEvent(c);
      const name = "conformance.no-such-event";
      const { id, res } = await c.send(
        EVENTS_METHODS.stream,
        { name, arguments: {}, cursor: null },
        { mcpName: name }
      );
      const x = await readExchange(res, id);
      const first = x.messages[0];
      if (first?.method === EVENTS_NOTIFICATIONS.active)
        return fail("an active frame preceded the error");
      return x.response?.error
        ? pass()
        : fail(`expected a JSON-RPC error, got HTTP ${x.status}`);
    },
  }),
  check({
    id: "CURSOR-CONSISTENT",
    profiles: ["sep-3415"],
    level: "SHOULD",
    cite: "events.mdx:700",
    async run(c) {
      const both = (await c.events()).filter(
        (e) => e.delivery?.includes("poll") && e.delivery.includes("push")
      );
      if (both.length === 0) return skip("no event offers both poll and push");
      for (const e of both) {
        const p = await poll(c, e, null);
        const s = await open(c, e);
        try {
          const f = await s.next(c.timing.requestMs);
          const sc = f?.m.params?.cursor;
          if (f && (p.cursor === null) !== (sc === null)) {
            return fail(
              `${e.name}: poll cursor ${JSON.stringify(p.cursor)} vs stream cursor ${JSON.stringify(sc)}`
            );
          }
        } finally {
          s.close();
        }
      }
      return pass();
    },
  }),
];
