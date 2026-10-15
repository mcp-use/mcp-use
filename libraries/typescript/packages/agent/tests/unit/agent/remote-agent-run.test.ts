import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RemoteAgent } from "../../../src/agents/remote.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("RemoteAgent.run response handling", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    // First call creates the chat session, second executes the query.
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: "chat-1" }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const agent = () =>
    new RemoteAgent({ agentId: "agent-1", apiKey: "test-key" });

  it("returns the result when the body omits the error field", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: "hello" }));

    await expect(agent().run({ prompt: "hi" })).resolves.toBe("hello");
  });

  it("returns the result when error is null", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ result: "hello", error: null })
    );

    await expect(agent().run({ prompt: "hi" })).resolves.toBe("hello");
  });

  it("throws the server's error message when error is set", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ result: null, error: "boom" })
    );

    await expect(agent().run({ prompt: "hi" })).rejects.toThrow(
      "Remote agent execution failed: boom"
    );
  });

  it("includes the response body when status is error without a message", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "error" }));

    await expect(agent().run({ prompt: "hi" })).rejects.toThrow(
      '{"status":"error"}'
    );
  });
});
