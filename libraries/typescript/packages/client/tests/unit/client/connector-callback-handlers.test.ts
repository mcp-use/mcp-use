/**
 * Regression tests for inbound v1 request-handler registration/dispatch.
 *
 * Covers:
 * - sampling/createMessage and elicitation/create method registration
 * - forwarding of request params and callback results
 *
 * Run with: pnpm test:run tests/unit/client/connector-callback-handlers.test.ts
 */

import { describe, it, expect, vi } from "vitest";
import { BaseConnector } from "../../../src/transport/base.js";

type MockClient = {
  handlers: Map<string, (request: { params: unknown }) => Promise<unknown>>;
  setRequestHandler: ReturnType<typeof vi.fn>;
};

function createMockClient(): MockClient {
  const handlers = new Map<
    string,
    (request: { params: unknown }) => Promise<unknown>
  >();
  return {
    handlers,
    setRequestHandler: vi.fn((method: string, handler) => {
      handlers.set(method, handler);
    }),
  };
}

const samplingResult = {
  role: "assistant" as const,
  content: { type: "text" as const, text: "sampled" },
  model: "test-model",
  stopReason: "endTurn" as const,
};

describe("BaseConnector inbound request handlers", () => {
  it("registers sampling/createMessage and forwards params/result", async () => {
    const onSampling = vi.fn().mockResolvedValue(samplingResult);
    const connector = new BaseConnector({ onSampling });
    const client = createMockClient();
    (connector as any).client = client;

    (connector as any).setupSamplingHandler();

    expect(client.setRequestHandler).toHaveBeenCalledWith(
      "sampling/createMessage",
      expect.any(Function)
    );

    const params = {
      messages: [{ role: "user", content: { type: "text", text: "hi" } }],
      maxTokens: 32,
    };
    const result = await client.handlers.get("sampling/createMessage")!({
      params,
    });

    expect(onSampling).toHaveBeenCalledWith(params);
    expect(result).toEqual(samplingResult);
  });

  it("registers elicitation/create and forwards params/result", async () => {
    const elicitResult = {
      action: "accept" as const,
      content: { name: "Ada" },
    };
    const onElicitation = vi.fn().mockResolvedValue(elicitResult);
    const connector = new BaseConnector({ onElicitation });
    const client = createMockClient();
    (connector as any).client = client;

    (connector as any).setupElicitationHandler();

    expect(client.setRequestHandler).toHaveBeenCalledWith(
      "elicitation/create",
      expect.any(Function)
    );

    const params = {
      mode: "form" as const,
      message: "Your name?",
      requestedSchema: {
        type: "object",
        properties: { name: { type: "string" } },
      },
    };
    const result = await client.handlers.get("elicitation/create")!({
      params,
    });

    expect(onElicitation).toHaveBeenCalledWith(params);
    expect(result).toEqual(elicitResult);
  });

  it("does not register sampling or elicitation handlers without callbacks", () => {
    const connector = new BaseConnector();
    const client = createMockClient();
    (connector as any).client = client;

    (connector as any).setupSamplingHandler();
    (connector as any).setupElicitationHandler();

    expect(client.setRequestHandler).not.toHaveBeenCalled();
  });

  it("registers roots/list and returns current roots cache", async () => {
    const roots = [{ uri: "file:///tmp/project", name: "project" }];
    const connector = new BaseConnector({ roots });
    const client = createMockClient();
    (connector as any).client = client;

    (connector as any).setupRootsHandler();

    expect(client.setRequestHandler).toHaveBeenCalledWith(
      "roots/list",
      expect.any(Function)
    );
    const result = await client.handlers.get("roots/list")!({ params: {} });
    expect(result).toEqual({ roots });
  });
});
