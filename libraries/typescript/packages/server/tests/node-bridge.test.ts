import { afterEach, describe, expect, it } from "vitest";

import { markBufferedResponse } from "../src/buffered-response.js";
import { toWebRequest } from "../src/node-bridge.js";
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

describe("Node request bridge", () => {
  let listener: ListenFetchResult | undefined;

  afterEach(async () => {
    await listener?.close();
    listener = undefined;
  });

  it("passes binary request bodies to the handler unchanged", async () => {
    listener = await listenFetch(
      async (request) => new Response(await request.arrayBuffer())
    );
    // The PNG file signature; 0x89 is not valid UTF-8 on its own.
    const sent = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    const response = await fetch(listener.url, { method: "POST", body: sent });

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(sent);
  });

  it("joins a body split across chunks, including string chunks", async () => {
    const request = await toWebRequest({
      method: "POST",
      url: "/",
      headers: { host: "localhost" },
      async *[Symbol.asyncIterator]() {
        // "é" is split across the first two chunks.
        yield Uint8Array.from([0x63, 0x61, 0x66, 0xc3]);
        yield Uint8Array.from([0xa9]);
        yield "!";
      },
    });

    await expect(request.text()).resolves.toBe("café!");
  });
});
