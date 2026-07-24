import { afterEach, describe, expect, it } from "vitest";

import { listenFetch, type ListenFetchResult } from "./helpers/listen-fetch.js";

describe("Node response bridge", () => {
  let listener: ListenFetchResult | undefined;

  afterEach(async () => {
    await listener?.close();
    listener = undefined;
  });

  it("serves buffered JSON responses intact", async () => {
    listener = await listenFetch(async () =>
      Response.json({ jsonrpc: "2.0", id: 1, result: { ok: true } })
    );

    const response = await fetch(listener.url);

    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { ok: true },
    });
  });

  it("preserves streaming responses", async () => {
    const encoder = new TextEncoder();
    listener = await listenFetch(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("data: first\n\n"));
          controller.enqueue(encoder.encode("data: second\n\n"));
          controller.close();
        },
      });
      return new Response(body, {
        headers: { "content-type": "text/event-stream" },
      });
    });

    const response = await fetch(listener.url);

    expect(response.headers.get("content-type")).toBe("text/event-stream");
    await expect(response.text()).resolves.toBe(
      "data: first\n\ndata: second\n\n"
    );
  });
});
