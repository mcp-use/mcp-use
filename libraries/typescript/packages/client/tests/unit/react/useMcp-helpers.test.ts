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
  function monitorConnection(
    getAuthHeaders?: () => Promise<Record<string, string>>
  ) {
    const stateRef = { current: "ready" };
    const connect = vi.fn();
    const cleanup = startConnectionHealthMonitoring({
      url: "https://example.com/mcp",
      getAuthHeaders,
      isMountedRef: { current: true },
      stateRef,
      autoReconnectRef: { current: true },
      setState: (state) => {
        stateRef.current = state;
      },
      addLog: vi.fn(),
      connect,
      defaultReconnectDelay: 100,
      healthCheckIntervalMs: 10,
      healthCheckTimeoutMs: 0,
    });
    return { stateRef, connect, cleanup };
  }

  it("reconnects after a failed health check while monitoring is active", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const { connect, cleanup } = monitorConnection();
    await vi.advanceTimersByTimeAsync(110);
    expect(connect).toHaveBeenCalledOnce();
    cleanup();
  });

  it("cancels a queued reconnect when the old connection is cleaned up", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const { stateRef, connect, cleanup } = monitorConnection();
    await vi.advanceTimersByTimeAsync(10);
    expect(stateRef.current).toBe("discovering");
    cleanup();
    await vi.advanceTimersByTimeAsync(100);
    expect(connect).not.toHaveBeenCalled();
  });

  it("does not reconnect when a health check fails after cleanup", async () => {
    vi.useFakeTimers();
    let failHealthCheck!: (error: Error) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          failHealthCheck = reject;
        })
    );
    const { stateRef, connect, cleanup } = monitorConnection();
    await vi.advanceTimersByTimeAsync(10);
    cleanup();
    failHealthCheck(new Error("offline"));
    await vi.advanceTimersByTimeAsync(100);
    expect(stateRef.current).toBe("ready");
    expect(connect).not.toHaveBeenCalled();
  });

  it("clears every reconnect timer when health checks overlap", async () => {
    vi.useFakeTimers();
    const failChecks: Array<(error: Error) => void> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          failChecks.push(reject);
        })
    );
    const { cleanup } = monitorConnection();

    await vi.advanceTimersByTimeAsync(20);
    expect(failChecks).toHaveLength(2);
    failChecks[0](new Error("offline"));
    await Promise.resolve();
    failChecks[1](new Error("offline"));
    await Promise.resolve();

    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not fetch after cleanup while auth headers are pending", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    let resolveHeaders!: (headers: Record<string, string>) => void;
    const { cleanup } = monitorConnection(
      () => new Promise((resolve) => (resolveHeaders = resolve))
    );

    await vi.advanceTimersByTimeAsync(10);
    cleanup();
    resolveHeaders({});
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

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

describe("serializeClientIcons", () => {
  it("returns null for undefined icons and [] for empty icons array", async () => {
    const { serializeClientIcons } =
      await import("../../../src/react/useMcp-helpers.js");
    expect(serializeClientIcons(undefined)).toBe("null");
    expect(serializeClientIcons([])).toBe("[]");
  });

  it("preserves absent versus explicit empty optional fields", async () => {
    const { serializeClientIcons } =
      await import("../../../src/react/useMcp-helpers.js");
    const omittedMime = [{ src: "https://example.com/icon.png" }];
    const emptyMime = [{ src: "https://example.com/icon.png", mimeType: "" }];
    expect(serializeClientIcons(omittedMime)).not.toBe(
      serializeClientIcons(emptyMime)
    );

    const omittedSizes = [{ src: "https://example.com/icon.png" }];
    const emptySizes = [{ src: "https://example.com/icon.png", sizes: [] }];
    expect(serializeClientIcons(omittedSizes)).not.toBe(
      serializeClientIcons(emptySizes)
    );
  });

  it("serializes icons deterministically regardless of sizes order", async () => {
    const { serializeClientIcons } =
      await import("../../../src/react/useMcp-helpers.js");
    const icons1 = [
      {
        src: "https://example.com/icon.png",
        mimeType: "image/png",
        sizes: ["48x48", "16x16"],
      },
    ];
    const icons2 = [
      {
        src: "https://example.com/icon.png",
        mimeType: "image/png",
        sizes: ["16x16", "48x48"],
      },
    ];
    expect(serializeClientIcons(icons1)).toBe(serializeClientIcons(icons2));
  });

  it("produces different output when icon properties change", async () => {
    const { serializeClientIcons } =
      await import("../../../src/react/useMcp-helpers.js");
    const icons1 = [{ src: "https://example.com/icon1.png" }];
    const icons2 = [{ src: "https://example.com/icon2.png" }];
    expect(serializeClientIcons(icons1)).not.toBe(serializeClientIcons(icons2));
  });
});

describe("serializeProxyHeaders", () => {
  it("returns empty string when headers and customHeaders are both undefined", async () => {
    const { serializeProxyHeaders } =
      await import("../../../src/react/useMcp-helpers.js");
    expect(serializeProxyHeaders(undefined, undefined)).toBe("");
  });

  it("produces the same serialized output regardless of header key insertion order", async () => {
    const { serializeProxyHeaders } =
      await import("../../../src/react/useMcp-helpers.js");
    const headersA = { Authorization: "Bearer token", "X-Custom": "val" };
    const headersB = { "X-Custom": "val", Authorization: "Bearer token" };
    expect(serializeProxyHeaders(headersA)).toBe(
      serializeProxyHeaders(headersB)
    );
  });

  it("preserves distinction between customHeaders and headers sources", async () => {
    const { serializeProxyHeaders } =
      await import("../../../src/react/useMcp-helpers.js");
    const asHeaders = serializeProxyHeaders({ "X-A": "1" }, undefined);
    const asCustomHeaders = serializeProxyHeaders(undefined, { "X-A": "1" });
    expect(asHeaders).not.toBe(asCustomHeaders);
  });

  it("produces different output when a header value changes", async () => {
    const { serializeProxyHeaders } =
      await import("../../../src/react/useMcp-helpers.js");
    const headers1 = { "X-Custom": "val1" };
    const headers2 = { "X-Custom": "val2" };
    expect(serializeProxyHeaders(headers1)).not.toBe(
      serializeProxyHeaders(headers2)
    );
  });
});
