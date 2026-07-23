import { afterEach, describe, expect, it, vi } from "vitest";
import { MCPAgentExecutionEvent } from "../../../src/telemetry/events.js";
import { capturePostHog } from "../../../src/telemetry/tel-fetch.js";

describe("capturePostHog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drops content-like properties at the capture boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal("fetch", fetchMock);

    await capturePostHog({
      event: "agent_run",
      distinctId: "anonymous-id",
      properties: {
        query: "private prompt",
        response: "private response",
        authorization_header: "Bearer secret",
        server_identifier: "private-server",
        tools_used_names: ["private-tool"],
        model_name: "gpt-test",
        query_length: 14,
        response_length: "private response",
      },
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.properties).toEqual({
      model_name: "gpt-test",
      query_length: 14,
    });
  });

  it("swallows serialization errors from telemetry values", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal("fetch", fetchMock);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    await expect(
      capturePostHog({
        event: "invalid",
        distinctId: "anonymous-id",
        properties: { metadata: cyclic },
      })
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exposes only aggregate agent execution data", () => {
    const properties = new MCPAgentExecutionEvent({
      executionMethod: "run",
      query: "private prompt",
      success: true,
      modelProvider: "openai",
      modelName: "gpt-test",
      serverCount: 1,
      serverIdentifiers: [{ name: "private-server" }],
      totalToolsAvailable: 1,
      toolsAvailableNames: ["private-tool"],
      maxStepsConfigured: 10,
      memoryEnabled: false,
      useServerManager: false,
      maxStepsUsed: 1,
      manageConnector: true,
      externalHistoryUsed: false,
      toolsUsedCount: 1,
      toolsUsedNames: ["private-tool"],
      response: "private response",
    }).properties;

    expect(properties).toMatchObject({
      query_length: "private prompt".length,
      response_length: "private response".length,
      server_count: 1,
      total_tools_available: 1,
      tools_used_count: 1,
    });
    expect(JSON.stringify(properties)).not.toContain("private");
  });
});
