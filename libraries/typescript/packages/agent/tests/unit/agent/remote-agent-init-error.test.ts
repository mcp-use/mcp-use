import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RemoteAgent } from "../../../src/agents/remote.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("RemoteAgent.run initialization failure detection", () => {
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

  it("reports an initialization failure from a string error", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ result: null, error: "MCP agent failed to initialize" })
    );

    const run = agent().run({ prompt: "hi" });
    await expect(run).rejects.toThrow(
      "Agent initialization failed on remote server"
    );
    await expect(run).rejects.toThrow(
      "Raw error: MCP agent failed to initialize"
    );
  });

  it("reports an initialization failure from an object error", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: "error",
        error: { message: "agent failed to initialize" },
      })
    );

    const run = agent().run({ prompt: "hi" });
    await expect(run).rejects.toThrow(
      "Agent initialization failed on remote server"
    );
    await expect(run).rejects.toThrow(
      'Raw error: {"message":"agent failed to initialize"}'
    );
  });

  it("keeps the generic message for other errors", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ result: null, error: "boom" })
    );

    const run = agent().run({ prompt: "hi" });
    await expect(run).rejects.toThrow("Remote agent execution failed: boom");
    await expect(run).rejects.not.toThrow("Agent initialization failed");
  });

  it("does not treat a successful answer mentioning the phrase as an error", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        result: "The service failed to initialize because of a typo.",
        error: null,
      })
    );

    await expect(agent().run({ prompt: "why?" })).resolves.toBe(
      "The service failed to initialize because of a typo."
    );
  });
});
