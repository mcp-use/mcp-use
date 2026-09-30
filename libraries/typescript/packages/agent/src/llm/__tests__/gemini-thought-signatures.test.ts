import { afterEach, describe, expect, it, vi } from "vitest";

import { createLlmDriver } from "../driver.js";
import { runToolLoop, runToolLoopNonStreaming } from "../toolLoop.js";

const SIGNATURE = "CiQBcsjafExampleSignature==";

const toolCallCandidate = {
  content: {
    role: "model",
    parts: [
      {
        functionCall: { name: "get_weather", args: { city: "Paris" } },
        thoughtSignature: SIGNATURE,
      },
    ],
  },
};

const answerCandidate = {
  content: { role: "model", parts: [{ text: "It is sunny." }] },
};

function sseResponse(candidate: unknown): Response {
  return new Response(
    `data: ${JSON.stringify({ candidates: [candidate] })}\n\n`,
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }
  );
}

function jsonResponse(candidate: unknown): Response {
  return new Response(JSON.stringify({ candidates: [candidate] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function modelTurnOfSecondRequest(fetchMock: ReturnType<typeof vi.fn>) {
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
  return body.contents.find((c: { role: string }) => c.role === "model");
}

const loopParams = {
  messages: [{ role: "user" as const, content: "weather in Paris?" }],
  tools: [
    {
      name: "get_weather",
      description: "Get the weather",
      inputSchema: {
        type: "object",
        properties: { city: { type: "string" } },
      },
    },
  ],
  callTool: async () => ({ content: [{ type: "text", text: "sunny" }] }),
};

describe("Gemini thought signatures", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the functionCall thoughtSignature back on the next streamed turn", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse(toolCallCandidate))
      .mockResolvedValueOnce(sseResponse(answerCandidate));
    vi.stubGlobal("fetch", fetchMock);

    const driver = createLlmDriver({
      provider: "google",
      model: "gemini-3-pro-preview",
      apiKey: "test-key",
    });
    for await (const _ev of runToolLoop({ driver, ...loopParams })) {
      // consume
    }

    expect(modelTurnOfSecondRequest(fetchMock).parts).toEqual([
      {
        functionCall: { name: "get_weather", args: { city: "Paris" } },
        thoughtSignature: SIGNATURE,
      },
    ]);
  });

  it("sends the functionCall thoughtSignature back on the next non-streamed turn", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(toolCallCandidate))
      .mockResolvedValueOnce(jsonResponse(answerCandidate));
    vi.stubGlobal("fetch", fetchMock);

    const driver = createLlmDriver({
      provider: "google",
      model: "gemini-3-pro-preview",
      apiKey: "test-key",
    });
    const result = await runToolLoopNonStreaming({ driver, ...loopParams });

    expect(result.content).toBe("It is sunny.");
    expect(modelTurnOfSecondRequest(fetchMock).parts).toEqual([
      {
        functionCall: { name: "get_weather", args: { city: "Paris" } },
        thoughtSignature: SIGNATURE,
      },
    ]);
  });

  it("adds no thoughtSignature field when the model did not send one", async () => {
    const unsigned = {
      content: {
        role: "model",
        parts: [
          { functionCall: { name: "get_weather", args: { city: "Paris" } } },
        ],
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse(unsigned))
      .mockResolvedValueOnce(sseResponse(answerCandidate));
    vi.stubGlobal("fetch", fetchMock);

    const driver = createLlmDriver({
      provider: "google",
      model: "gemini-2.5-flash",
      apiKey: "test-key",
    });
    for await (const _ev of runToolLoop({ driver, ...loopParams })) {
      // consume
    }

    expect(modelTurnOfSecondRequest(fetchMock).parts).toEqual([
      { functionCall: { name: "get_weather", args: { city: "Paris" } } },
    ]);
  });
});
