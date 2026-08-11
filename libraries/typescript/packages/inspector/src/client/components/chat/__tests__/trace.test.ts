import { describe, expect, it } from "vitest";
import {
  appendTraceEvent,
  buildMessageTokenMap,
  buildRawChatPayload,
  EMPTY_TRACE_STATE,
  inspectorTokenUsageFromUnknown,
  redactSensitiveRequestFields,
  traceEventPreview,
  type InspectorTraceEvent,
  type InspectorTraceEventInput,
} from "../trace";

const event = (value: InspectorTraceEventInput, index: number) =>
  ({
    ...value,
    id: `event-${index}`,
    timestamp: index * 10,
  }) as InspectorTraceEvent;

describe("trace accumulator", () => {
  it("builds ordered spans and sums exact usage", () => {
    const events = [
      event({ type: "request", request: { model: "test" } }, 1),
      event(
        {
          type: "tool-call-start",
          toolCallId: "call-1",
          toolName: "search",
        },
        2
      ),
      event(
        {
          type: "tool-call-args",
          toolCallId: "call-1",
          toolName: "search",
          args: { query: "mcp" },
        },
        3
      ),
      event(
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "search",
          result: { count: 1 },
        },
        4
      ),
      event(
        {
          type: "usage",
          usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
        },
        5
      ),
      event({ type: "done" }, 6),
    ];
    const state = events.reduce(appendTraceEvent, EMPTY_TRACE_STATE);

    expect(state.spans.map((span) => [span.kind, span.status])).toEqual([
      ["llm", "success"],
      ["tool", "success"],
    ]);
    expect(state.spans[1]?.preview).toBe('{"count":1}');
    expect(state.usage).toMatchObject({
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
    });
  });

  it("maps server usage keys and keeps previews compact", () => {
    expect(
      inspectorTokenUsageFromUnknown({
        input_tokens: 7,
        output_tokens: 3,
      })
    ).toEqual({ inputTokens: 7, outputTokens: 3, totalTokens: 10 });
    expect(
      traceEventPreview(
        event(
          {
            type: "tool-call-args",
            toolCallId: "call-1",
            toolName: "search",
            args: { query: "x".repeat(200) },
          },
          1
        )
      ).length
    ).toBeLessThanOrEqual(121);
  });

  it("adds Anthropic cache counters to the total but not OpenAI's", () => {
    // Anthropic reports cache_read_input_tokens and cache_creation_input_tokens OUTSIDE
    // input_tokens and bills all of them, so both are added back into the total.
    expect(
      inspectorTokenUsageFromUnknown({
        input_tokens: 3,
        cache_read_input_tokens: 20000,
        cache_creation_input_tokens: 1500,
        output_tokens: 120,
      })
    ).toEqual({
      inputTokens: 3,
      outputTokens: 120,
      totalTokens: 21623,
      cachedInputTokens: 20000,
      cacheCreationInputTokens: 1500,
      reasoningTokens: undefined,
    });

    // A normalized OpenAI record: cachedInputTokens is already inside inputTokens, so it
    // must NOT be added again. Total is 10 + 4 = 14, not 17.
    expect(
      inspectorTokenUsageFromUnknown({
        inputTokens: 10,
        outputTokens: 4,
        cachedInputTokens: 3,
      })
    ).toMatchObject({
      inputTokens: 10,
      outputTokens: 4,
      totalTokens: 14,
      cachedInputTokens: 3,
    });
  });

  it("keeps cacheCreationInputTokens through aggregation and the LLM span", () => {
    const events = [
      event({ type: "request", request: { model: "test" } }, 1),
      event(
        {
          type: "usage",
          usage: {
            inputTokens: 3,
            outputTokens: 120,
            totalTokens: 21623,
            cachedInputTokens: 20000,
            cacheCreationInputTokens: 1500,
          },
        },
        2
      ),
      event(
        {
          type: "usage",
          usage: { cacheCreationInputTokens: 500 },
        },
        3
      ),
      event({ type: "done" }, 4),
    ];
    const state = events.reduce(appendTraceEvent, EMPTY_TRACE_STATE);

    // Survives in the aggregate state...
    expect(state.usage?.cacheCreationInputTokens).toBe(2000);
    // ...and on the LLM span's own usage.
    const llmSpan = state.spans.find((span) => span.kind === "llm");
    expect(llmSpan?.usage?.cacheCreationInputTokens).toBe(2000);
  });

  it("redacts secrets without hiding token counts", () => {
    expect(
      redactSensitiveRequestFields({
        apiKey: "secret",
        nested: { access_token: "secret", inputTokens: 12 },
      })
    ).toEqual({
      apiKey: "[REDACTED]",
      nested: { access_token: "[REDACTED]", inputTokens: 12 },
    });
  });

  it("groups request/response events into turns for raw view", () => {
    const events = [
      event({ type: "request", request: { model: "a" } }, 1),
      event({ type: "text-delta", delta: "hi" }, 2),
      event({ type: "done" }, 3),
      event({ type: "request", request: { model: "b" } }, 4),
      event({ type: "text-delta", delta: "bye" }, 5),
    ];
    const payload = buildRawChatPayload(events, {
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
    });

    expect(payload.turns).toHaveLength(2);
    expect(payload.turns[0]?.response.map((e) => e.type)).toEqual([
      "text-delta",
      "done",
    ]);
    expect(payload.turns[1]?.request.request).toEqual({ model: "b" });
    expect(payload.tokenUsage).toMatchObject({ totalTokens: 3 });
  });

  it("maps per-turn usage onto user and assistant message ids", () => {
    const events = [
      event({ type: "request", request: { model: "a" } }, 1),
      event(
        {
          type: "usage",
          usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
        },
        2
      ),
      event({ type: "done" }, 3),
    ];
    const messages = [
      { id: "user-1", role: "user" },
      { id: "assistant-1", role: "assistant" },
    ];
    const map = buildMessageTokenMap(messages, events);

    expect(map.get("user-1")).toEqual({ inputTokens: 100 });
    expect(map.get("assistant-1")).toEqual({ outputTokens: 40 });
  });
});
