import { describe, expect, it, vi } from "vitest";
import { HttpConnector } from "../../../src/transport/http.js";

describe("HttpConnector observeSseProgress TransformStream lifecycle", () => {
  it("forwards progress notifications while delivering all SSE bytes to the consumer", async () => {
    const connector = new HttpConnector("https://mcp.example.com/mcp");
    const progressSpy = vi.spyOn(connector as any, "forwardRoundProgress");

    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":50,"total":100}}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'data: {"jsonrpc":"2.0","result":{"content":[{"type":"text","text":"done"}]}}\n\n'
          )
        );
        controller.close();
      },
    });

    const response = new Response(source, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const observedResponse = (connector as any).observeSseProgress(response);
    const text = await observedResponse.text();

    expect(progressSpy).toHaveBeenCalledTimes(1);
    expect(progressSpy).toHaveBeenCalledWith({ progress: 50, total: 100 });
    expect(text).toContain("notifications/progress");
    expect(text).toContain("done");
  });

  it("propagates consumer cancellation upstream to the underlying stream source", async () => {
    const connector = new HttpConnector("https://mcp.example.com/mcp");
    const encoder = new TextEncoder();
    const cancelSpy = vi.fn();

    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}\n\n'
          )
        );
      },
      cancel(reason) {
        cancelSpy(reason);
      },
    });

    const response = new Response(source, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const observedResponse = (connector as any).observeSseProgress(response);
    const reader = observedResponse.body!.getReader();

    // Read the first chunk
    const firstChunk = await reader.read();
    expect(firstChunk.done).toBe(false);

    // Cancel the consumer stream (as occurs on request abort or SDK teardown)
    await reader.cancel("caller aborted request");

    // Allow async pipe microtasks to settle
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalledWith("caller aborted request");
  });

  it("returns non-SSE responses directly without piping through TransformStream", async () => {
    const connector = new HttpConnector("https://mcp.example.com/mcp");
    const response = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const observed = (connector as any).observeSseProgress(response);
    expect(observed).toBe(response);
  });

  it("handles empty response bodies gracefully", async () => {
    const connector = new HttpConnector("https://mcp.example.com/mcp");
    const response = new Response(null, {
      status: 204,
      headers: { "content-type": "text/event-stream" },
    });

    const observed = (connector as any).observeSseProgress(response);
    expect(observed).toBe(response);
  });

  it("handles malformed JSON in SSE events without disrupting stream delivery", async () => {
    const connector = new HttpConnector("https://mcp.example.com/mcp");
    const progressSpy = vi.spyOn(connector as any, "forwardRoundProgress");
    const encoder = new TextEncoder();

    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: invalid-json-payload\n\n"));
        controller.enqueue(
          encoder.encode(
            'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":100}}\n\n'
          )
        );
        controller.close();
      },
    });

    const response = new Response(source, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const observedResponse = (connector as any).observeSseProgress(response);
    const text = await observedResponse.text();

    expect(progressSpy).toHaveBeenCalledTimes(1);
    expect(progressSpy).toHaveBeenCalledWith({ progress: 100 });
    expect(text).toContain("invalid-json-payload");
  });

  it("propagates stream read errors downstream to the consumer", async () => {
    const connector = new HttpConnector("https://mcp.example.com/mcp");
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("upstream connection reset"));
      },
    });

    const response = new Response(source, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const observedResponse = (connector as any).observeSseProgress(response);
    await expect(observedResponse.text()).rejects.toThrow(
      "upstream connection reset"
    );
  });
});
