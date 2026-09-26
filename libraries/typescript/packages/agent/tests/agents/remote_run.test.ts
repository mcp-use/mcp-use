import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RemoteAgent } from "../../src/agents/remote.js";

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Stubs `fetch` to replay the given JSON bodies with HTTP 200, in order. */
function stubFetchResponses(bodies: unknown[]): void {
  (globalThis as any).fetch = async () => {
    const body = bodies.length > 1 ? bodies.shift() : bodies[0];
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}

function makeAgent(): RemoteAgent {
  return new RemoteAgent({
    agentId: "agent-1",
    apiKey: "test-key",
    baseUrl: "http://127.0.0.1:1",
  });
}

describe("RemoteAgent.run response handling", () => {
  it("resolves the result when the body has no error field", async () => {
    stubFetchResponses([{ id: "chat-1" }, { result: "The answer" }]);

    await expect(makeAgent().run({ prompt: "hi" })).resolves.toBe("The answer");
  });

  it("resolves the result when the body reports status success", async () => {
    stubFetchResponses([
      { id: "chat-1" },
      { status: "success", result: "The answer" },
    ]);

    await expect(makeAgent().run({ prompt: "hi" })).resolves.toBe("The answer");
  });

  it("resolves the result when the body carries an explicit error: null", async () => {
    stubFetchResponses([
      { id: "chat-1" },
      { result: "The answer", error: null },
    ]);

    await expect(makeAgent().run({ prompt: "hi" })).resolves.toBe("The answer");
  });

  it("rejects when the body carries an error despite a 200 status", async () => {
    stubFetchResponses([
      { id: "chat-1" },
      { result: "The answer", error: "Agent exploded" },
    ]);

    await expect(makeAgent().run({ prompt: "hi" })).rejects.toThrow(
      /Agent exploded/
    );
  });

  it("rejects when the body reports status error", async () => {
    stubFetchResponses([
      { id: "chat-1" },
      { status: "error", error: "Agent exploded" },
    ]);

    await expect(makeAgent().run({ prompt: "hi" })).rejects.toThrow(
      /Agent exploded/
    );
  });

  it("renders object error values in the rejection message", async () => {
    stubFetchResponses([
      { id: "chat-1" },
      { result: "The answer", error: { message: "Agent exploded" } },
    ]);

    await expect(makeAgent().run({ prompt: "hi" })).rejects.toThrow(
      /"message":"Agent exploded"/
    );
  });

  it("resolves when the result text merely mentions an initialization failure", async () => {
    stubFetchResponses([
      { id: "chat-1" },
      {
        result:
          "The remote agent failed to initialize because the MCP server URL was wrong",
      },
    ]);

    await expect(makeAgent().run({ prompt: "hi" })).resolves.toBe(
      "The remote agent failed to initialize because the MCP server URL was wrong"
    );
  });
});
