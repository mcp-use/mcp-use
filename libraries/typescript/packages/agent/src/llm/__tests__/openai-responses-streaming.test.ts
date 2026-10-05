import { afterEach, describe, expect, it, vi } from "vitest";

import { streamResponsesTurn } from "../providers/openai-responses.js";

function sseBody(events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

describe("OpenAI Responses streaming", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tracks streamed function-call arguments by item_id", async () => {
    // The Responses API keys function_call_arguments delta/done events by
    // item_id (the fc_... output item id), not by call_id.
    const sse = sseBody([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          id: "fc_1",
          type: "function_call",
          call_id: "call_1",
          name: "test_simple_text",
          arguments: "",
        },
      },
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_1",
        output_index: 0,
        delta: '{"message":"Drawer',
      },
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_1",
        output_index: 0,
        delta: ' test"}',
      },
      {
        type: "response.function_call_arguments.done",
        item_id: "fc_1",
        output_index: 0,
        arguments: '{"message":"Drawer test"}',
      },
      {
        type: "response.completed",
        response: {
          output: [
            {
              id: "fc_1",
              type: "function_call",
              call_id: "call_1",
              name: "test_simple_text",
              arguments: '{"message":"Drawer test"}',
            },
          ],
        },
      },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const events = [];
    for await (const event of streamResponsesTurn({
      config: { provider: "openai", model: "gpt-5-nano", apiKey: "test-key" },
      input: [],
      tools: [
        {
          name: "test_simple_text",
          description: "Echo text",
          inputSchema: {
            type: "object",
            properties: { message: { type: "string" } },
          },
        },
      ],
    })) {
      events.push(event);
    }

    const start = events.find((e) => e.type === "tool-call-start");
    expect(start).toMatchObject({
      toolCallId: "call_1",
      toolName: "test_simple_text",
    });

    const deltas = events.filter((e) => e.type === "tool-call-args-delta");
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toMatchObject({
      toolCallId: "call_1",
      argsDelta: '{"message":"Drawer',
    });
    expect(deltas[1]).toMatchObject({
      toolCallId: "call_1",
      argsDelta: ' test"}',
    });

    const ready = events.find((e) => e.type === "tool-call-ready");
    expect(ready).toMatchObject({
      toolCallId: "call_1",
      toolName: "test_simple_text",
      args: { message: "Drawer test" },
    });
  });
});
