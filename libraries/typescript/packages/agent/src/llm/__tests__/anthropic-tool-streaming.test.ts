import { afterEach, describe, expect, it, vi } from "vitest";

import { streamChat } from "../providers/anthropic.js";

describe("Anthropic tool streaming", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests eager input streaming for every streamed tool", async () => {
    const sse = [
      {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "tool_1",
          name: "create_view",
          input: {},
        },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: '{"elements":"<svg>',
        },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '</svg>"}' },
      },
      { type: "content_block_stop", index: 0 },
      { type: "message_stop" },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const events = [];
    for await (const event of streamChat({
      config: {
        provider: "anthropic",
        model: "claude-test",
        apiKey: "test-key",
      },
      messages: [{ role: "user", content: "draw something" }],
      tools: [
        {
          name: "create_view",
          description: "Render a view",
          inputSchema: {
            type: "object",
            properties: { elements: { type: "string" } },
          },
        },
      ],
    })) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(body.stream).toBe(true);
    expect(body.tools).toEqual([
      expect.objectContaining({
        name: "create_view",
        eager_input_streaming: true,
      }),
    ]);
    expect(events).toEqual([
      expect.objectContaining({
        type: "tool-call-start",
        toolCallId: "tool_1",
      }),
      expect.objectContaining({
        type: "tool-call-args-delta",
        argsDelta: '{"elements":"<svg>',
      }),
      expect.objectContaining({
        type: "tool-call-args-delta",
        argsDelta: '</svg>"}',
      }),
      expect.objectContaining({
        type: "tool-call-ready",
        args: { elements: "<svg></svg>" },
      }),
      { type: "done" },
    ]);
  });

  it("does not emit an executable tool call for malformed arguments", async () => {
    const sse = [
      {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "tool_1",
          name: "create_view",
          input: {},
        },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: '{"elements":',
        },
      },
      { type: "content_block_stop", index: 0 },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      )
    );

    const events = [];
    for await (const event of streamChat({
      config: {
        provider: "anthropic",
        model: "claude-test",
        apiKey: "test-key",
      },
      messages: [{ role: "user", content: "draw something" }],
      tools: [
        {
          name: "create_view",
          inputSchema: { type: "object" },
        },
      ],
    })) {
      events.push(event);
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("invalid JSON arguments"),
      })
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "tool-call-ready" })
    );
  });
});
