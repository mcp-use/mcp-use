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

  it("keeps calls apart when one call's item id equals another's call_id", async () => {
    // A nonstandard producer can hand out an fc_... item id that equals some
    // other call's call_id. Unprefixed map keys would let the second call's
    // entry overwrite the first, and the first call's deltas would come out
    // with the second call's toolCallId and toolName.
    const sse = sseBody([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          id: "fc_1",
          type: "function_call",
          call_id: "call_1",
          name: "tool_a",
          arguments: "",
        },
      },
      {
        type: "response.output_item.added",
        output_index: 1,
        item: {
          id: "fc_2",
          type: "function_call",
          call_id: "fc_1",
          name: "tool_b",
          arguments: "",
        },
      },
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_1",
        output_index: 0,
        delta: '{"a":1}',
      },
      {
        type: "response.function_call_arguments.done",
        item_id: "fc_1",
        output_index: 0,
        arguments: '{"a":1}',
      },
    ]);
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
    for await (const event of streamResponsesTurn({
      config: { provider: "openai", model: "gpt-5-nano", apiKey: "test-key" },
      input: [],
      tools: [],
    })) {
      events.push(event);
    }

    const delta = events.find((e) => e.type === "tool-call-args-delta");
    expect(delta).toMatchObject({ toolCallId: "call_1", toolName: "tool_a" });
    const ready = events.find((e) => e.type === "tool-call-ready");
    expect(ready).toMatchObject({
      toolCallId: "call_1",
      toolName: "tool_a",
      args: { a: 1 },
    });
  });

  it("falls back to call_id when item_id is an empty string", async () => {
    const sse = sseBody([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          id: "",
          type: "function_call",
          call_id: "call_xyz",
          name: "tool_c",
          arguments: "",
        },
      },
      {
        type: "response.function_call_arguments.delta",
        item_id: "",
        call_id: "call_xyz",
        output_index: 0,
        delta: '{"city":"Rome"}',
      },
      {
        type: "response.function_call_arguments.done",
        item_id: "",
        call_id: "call_xyz",
        output_index: 0,
        arguments: '{"city":"Rome"}',
      },
    ]);
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
    for await (const event of streamResponsesTurn({
      config: { provider: "openai", model: "gpt-5-nano", apiKey: "test-key" },
      input: [],
      tools: [],
    })) {
      events.push(event);
    }

    const delta = events.find((e) => e.type === "tool-call-args-delta");
    expect(delta).toMatchObject({
      toolCallId: "call_xyz",
      toolName: "tool_c",
      argsDelta: '{"city":"Rome"}',
    });
    const ready = events.find((e) => e.type === "tool-call-ready");
    expect(ready).toMatchObject({
      toolCallId: "call_xyz",
      toolName: "tool_c",
      args: { city: "Rome" },
    });
  });

  it("resolves call_id-keyed events when item id equals call_id", async () => {
    // A producer can send identical item.id and call_id and tag the
    // arguments events with call_id only. The call: alias must still be in
    // the map, or those events lose the arguments.
    const sse = sseBody([
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          id: "same_id",
          type: "function_call",
          call_id: "same_id",
          name: "tool_d",
          arguments: "",
        },
      },
      {
        type: "response.function_call_arguments.delta",
        call_id: "same_id",
        output_index: 0,
        delta: '{"n":2}',
      },
      {
        type: "response.function_call_arguments.done",
        call_id: "same_id",
        output_index: 0,
        arguments: '{"n":2}',
      },
    ]);
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
    for await (const event of streamResponsesTurn({
      config: { provider: "openai", model: "gpt-5-nano", apiKey: "test-key" },
      input: [],
      tools: [],
    })) {
      events.push(event);
    }

    const delta = events.find((e) => e.type === "tool-call-args-delta");
    expect(delta).toMatchObject({
      toolCallId: "same_id",
      toolName: "tool_d",
      argsDelta: '{"n":2}',
    });
    const ready = events.find((e) => e.type === "tool-call-ready");
    expect(ready).toMatchObject({
      toolCallId: "same_id",
      toolName: "tool_d",
      args: { n: 2 },
    });
  });
});
