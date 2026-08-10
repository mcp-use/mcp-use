import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveOAuthProxyUrl,
  startConnectionHealthMonitoring,
} from "../../../src/react/useMcp-helpers.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("deriveOAuthProxyUrl", () => {
  it("derives the OAuth endpoint from an Inspector MCP proxy", () => {
    expect(
      deriveOAuthProxyUrl(
        "https://inspector.example.com/inspector/api/proxy",
        undefined
      )
    ).toBe("https://inspector.example.com/inspector/api/oauth");
  });

  it("keeps an explicit OAuth proxy unchanged", () => {
    expect(
      deriveOAuthProxyUrl(
        "https://inspector.example.com/inspector/api/proxy",
        "https://oauth.example.com/proxy"
      )
    ).toBe("https://oauth.example.com/proxy");
  });
});

describe("startConnectionHealthMonitoring", () => {
  it("targets the logical MCP URL through a proxy and stops after HEAD is rejected", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 405 }));

    const cleanup = startConnectionHealthMonitoring({
      gatewayUrl: "http://localhost:3000/inspector/api/proxy",
      url: "https://mcp.supabase.com/mcp",
      isMountedRef: { current: true },
      stateRef: { current: "ready" },
      autoReconnectRef: { current: true },
      setState: vi.fn(),
      addLog: vi.fn(),
      connect: vi.fn(),
      defaultReconnectDelay: 3000,
      healthCheckIntervalMs: 10000,
    });

    await vi.advanceTimersByTimeAsync(10000);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [requestUrl, requestInit] = fetchMock.mock.calls[0];
    expect(requestUrl).toBe("http://localhost:3000/inspector/api/proxy");
    expect(requestInit?.method).toBe("HEAD");
    expect(new Headers(requestInit?.headers).get("X-Target-URL")).toBe(
      "https://mcp.supabase.com/mcp"
    );

    await vi.advanceTimersByTimeAsync(30000);
    expect(fetchMock).toHaveBeenCalledOnce();

    cleanup();
  });
});
