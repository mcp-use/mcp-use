import { describe, expect, it, vi } from "vitest";
import { LlmRequestError } from "../providers/openai-chat-completions.js";
import { runToolLoop } from "../toolLoop.js";
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
});
