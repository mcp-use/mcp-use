import { describe, expect, it, vi } from "vitest";
import { LlmRequestError } from "../providers/openai-chat-completions.js";
import { runToolLoop, runToolLoopNonStreaming } from "../toolLoop.js";
import type { LlmDriver } from "../driver.js";

describe("runToolLoop", () => {
  it("re-throws LlmRequestError so callers can read status/body", async () => {
    const llmError = new LlmRequestError(
      429,
      'OpenAI request failed (429 Too Many Requests): {"error":"rate_limited","loginRequired":true,"loginUrl":"https://manufact.com/login"}',
      {
        error: "rate_limited",
        loginRequired: true,
        loginUrl: "https://manufact.com/login",
      }
    );

    const driver: LlmDriver = {
      stream: vi.fn(() =>
        (async function* () {
          throw llmError;
        })()
      ),
      complete: vi.fn(),
    };

    const events = runToolLoop({
      driver,
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      callTool: async () => ({}),
    });

    await expect(async () => {
      for await (const _ev of events) {
        // consume
      }
    }).rejects.toMatchObject({
      name: "LlmRequestError",
      status: 429,
      body: {
        loginRequired: true,
        loginUrl: "https://manufact.com/login",
      },
    });
  });

  it("still yields plain error events for non-structured failures", async () => {
    const driver: LlmDriver = {
      stream: vi.fn(() =>
        (async function* () {
          throw new Error("network down");
        })()
      ),
      complete: vi.fn(),
    };

    const events = runToolLoop({
      driver,
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      callTool: async () => ({}),
    });

    const collected: unknown[] = [];
    for await (const ev of events) {
      collected.push(ev);
    }

    expect(collected).toEqual([{ type: "error", message: "network down" }]);
  });

  it("stops dispatching tools when signal is aborted during tool execution", async () => {
    const controller = new AbortController();
    const callTool = vi.fn(async (name: string) => {
      if (name === "tool1") {
        controller.abort();
      }
      return { ok: true };
    });

    const driver: LlmDriver = {
      stream: vi.fn(() =>
        (async function* () {
          yield {
            type: "tool-call-ready",
            toolCallId: "1",
            toolName: "tool1",
            args: {},
          } as const;
          yield {
            type: "tool-call-ready",
            toolCallId: "2",
            toolName: "tool2",
            args: {},
          } as const;
        })()
      ),
      complete: vi.fn(),
    };

    const events = runToolLoop({
      driver,
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      callTool,
      signal: controller.signal,
    });

    for await (const _ev of events) {
      // consume
    }

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith("tool1", {});
  });
});

describe("runToolLoopNonStreaming", () => {
  it("stops dispatching remaining tool calls in a turn when signal is aborted", async () => {
    const controller = new AbortController();
    const callTool = vi.fn(async (name: string) => {
      if (name === "tool1") {
        controller.abort();
      }
      return { ok: true };
    });

    const driver: LlmDriver = {
      stream: vi.fn(),
      complete: vi.fn(async () => ({
        text: "",
        toolCalls: [
          { id: "1", name: "tool1", args: {} },
          { id: "2", name: "tool2", args: {} },
        ],
      })),
    };

    const result = await runToolLoopNonStreaming({
      driver,
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      callTool,
      signal: controller.signal,
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith("tool1", {});
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolName).toBe("tool1");
  });

  it("does not dispatch tool calls when signal is pre-aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const callTool = vi.fn(async () => ({ ok: true }));
    const driver: LlmDriver = {
      stream: vi.fn(),
      complete: vi.fn(async () => ({
        text: "",
        toolCalls: [{ id: "1", name: "tool1", args: {} }],
      })),
    };

    const result = await runToolLoopNonStreaming({
      driver,
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      callTool,
      signal: controller.signal,
    });

    expect(callTool).not.toHaveBeenCalled();
    expect(driver.complete).not.toHaveBeenCalled();
    expect(result.toolCalls).toHaveLength(0);
  });
});
