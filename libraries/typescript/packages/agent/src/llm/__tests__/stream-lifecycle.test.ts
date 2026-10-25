import { describe, expect, it } from "vitest";
import { parseNDJSON } from "../ndjson.js";
import { parseSSE } from "../sse.js";

const encoder = new TextEncoder();
const parsers = [
  {
    name: "SSE",
    parse: parseSSE,
    frame: "data: first\n\n",
    first: { event: undefined, data: "first" },
  },
  {
    name: "NDJSON",
    parse: parseNDJSON,
    frame: '{"text":"first"}\n',
    first: { text: "first" },
  },
];

describe.each(parsers)("$name reader ownership", ({ parse, frame, first }) => {
  it("cancels the response when its consumer stops early", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frame));
      },
      cancel() {
        cancelled = true;
      },
    });
    const events = parse(body);

    expect(await events.next()).toEqual({ done: false, value: first });
    await events.return();

    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it("preserves a consumer error when response cancellation rejects", async () => {
    const failure = new Error("consumer stopped processing");
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frame));
      },
      cancel() {
        cancelled = true;
        return Promise.reject(new Error("upstream cleanup failed"));
      },
    });

    await expect(
      (async () => {
        for await (const event of parse(body)) {
          expect(event).toEqual(first);
          throw failure;
        }
      })()
    ).rejects.toBe(failure);

    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it("cancels the response when the next read sees an aborted signal", async () => {
    const abort = new AbortController();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frame));
      },
      cancel() {
        cancelled = true;
      },
    });
    const events = parse(body, abort.signal);
    expect(await events.next()).toEqual({ done: false, value: first });

    abort.abort();
    expect(await events.next()).toEqual({ done: true, value: undefined });

    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it("waits for cancellation before releasing its reader", async () => {
    let finishCancellation!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      finishCancellation = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frame));
      },
      cancel() {
        return cleanup;
      },
    });
    const events = parse(body);
    await events.next();
    const closing = events.return();

    try {
      await Promise.resolve();
      expect(body.locked).toBe(true);
    } finally {
      finishCancellation();
      await closing;
    }
    expect(body.locked).toBe(false);
  });

  it("finishes an early return even if cancellation rejects", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frame));
      },
      cancel() {
        cancelled = true;
        return Promise.reject(new Error("upstream already unavailable"));
      },
    });
    const events = parse(body);
    await events.next();

    await expect(events.return()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it("preserves all output and releases the reader at natural EOF", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(frame + frame));
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const output = [];
    for await (const event of parse(body)) output.push(event);

    expect(output).toEqual([first, first]);
    expect(cancelled).toBe(false);
    expect(body.locked).toBe(false);
  });

  it("preserves an upstream read error and releases its reader", async () => {
    const failure = new Error("response body failed");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(failure);
      },
    });

    await expect(parse(body).next()).rejects.toBe(failure);
    expect(body.locked).toBe(false);
  });
});
