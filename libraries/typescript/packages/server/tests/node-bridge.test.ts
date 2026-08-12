import { afterEach, describe, expect, it } from "vitest";

import { markBufferedResponse } from "../src/buffered-response.js";
import { listenFetch, type ListenFetchResult } from "./helpers/listen-fetch.js";

describe("Node response bridge", () => {
  let listener: ListenFetchResult | undefined;

  afterEach(async () => {
    await listener?.close();
    listener = undefined;
  });

  it("serves buffered JSON responses intact", async () => {
    listener = await listenFetch(async () =>
      markBufferedResponse(
        Response.json({ jsonrpc: "2.0", id: 1, result: { ok: true } })
      )
    );

    const response = await fetch(listener.url);

    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { ok: true },
    });
  });

  it("streams unmarked JSON responses without waiting for completion", async () => {
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    listener = await listenFetch(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          controller = streamController;
          streamController.enqueue(encoder.encode('{"first":'));
        },
      });
      return new Response(body, {
        headers: { "content-type": "application/json" },
      });
    });

    const responsePromise = fetch(listener.url);
    const outcome = await Promise.race([
      responsePromise.then(() => "response" as const),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), 250)
      ),
    ]);
    if (outcome === "timeout") {
      controller?.close();
    }
    expect(outcome).toBe("response");

    const response = await responsePromise;
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('{"first":');

    controller?.enqueue(encoder.encode("true}"));
    controller?.close();
    const second = await reader.read();
    expect(new TextDecoder().decode(second.value)).toBe("true}");
    await expect(reader.read()).resolves.toEqual({
      done: true,
      value: undefined,
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

  it("preserves multiple Set-Cookie response headers", async () => {
    listener = await listenFetch(async () => {
      const headers = new Headers();
      headers.append("set-cookie", "session_token=token; Path=/; HttpOnly");
      headers.append("set-cookie", "session_data=data; Path=/; HttpOnly");
      return new Response("ok", { headers });
    });

    const response = await fetch(listener.url);

    expect(response.headers.getSetCookie()).toEqual([
      "session_token=token; Path=/; HttpOnly",
      "session_data=data; Path=/; HttpOnly",
    ]);
  });
});
