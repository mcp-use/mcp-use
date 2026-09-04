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

describe("serializeClientIcons", () => {
  it("returns empty string when icons are undefined or empty", async () => {
    const { serializeClientIcons } =
      await import("../../../src/react/useMcp-helpers.js");
    expect(serializeClientIcons(undefined)).toBe("");
    expect(serializeClientIcons([])).toBe("");
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
  it("returns empty string when headers and customHeaders are undefined or empty", async () => {
    const { serializeProxyHeaders } =
      await import("../../../src/react/useMcp-helpers.js");
    expect(serializeProxyHeaders(undefined, undefined)).toBe("");
    expect(serializeProxyHeaders({}, {})).toBe("");
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

  it("merges customHeaders with headers where headers take precedence", async () => {
    const { serializeProxyHeaders } =
      await import("../../../src/react/useMcp-helpers.js");
    const custom = { "X-A": "1", "X-B": "2" };
    const headers = { "X-B": "overridden", "X-C": "3" };
    expect(serializeProxyHeaders(headers, custom)).toBe(
      JSON.stringify([
        ["X-A", "1"],
        ["X-B", "overridden"],
        ["X-C", "3"],
      ])
    );
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
