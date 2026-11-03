import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveOAuthProxyUrl,
  loadServerIcon,
  startConnectionHealthMonitoring,
} from "../../../src/react/useMcp-helpers.js";
import { detectFavicon } from "../../../src/utils/favicon.js";

vi.mock("../../../src/utils/favicon.js", () => ({
  detectFavicon: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(detectFavicon).mockReset();
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

describe("loadServerIcon", () => {
  it("falls back to favicon detection when the server icon request fails", async () => {
    vi.mocked(detectFavicon).mockResolvedValue("data:image/png;base64,icon");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404 })
    );

    const result = await loadServerIcon({
      serverInfo: {
        name: "demo",
        icons: [{ src: "https://example.com/icon.svg" }],
      },
      url: "https://example.com/mcp",
      isMounted: () => true,
      setServerInfo: vi.fn(),
      addLog: vi.fn(),
    });

    expect(result).toBe("data:image/png;base64,icon");
    expect(detectFavicon).toHaveBeenCalledWith("https://example.com/mcp");
  });

  it("falls back when a successful icon response is not an image", async () => {
    vi.mocked(detectFavicon).mockResolvedValue("data:image/png;base64,icon");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>Not an icon</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const result = await loadServerIcon({
      serverInfo: {
        name: "demo",
        icons: [{ src: "https://example.com/icon.svg" }],
      },
      url: "https://example.com/mcp",
      isMounted: () => true,
      setServerInfo: vi.fn(),
      addLog: vi.fn(),
    });

    expect(result).toBe("data:image/png;base64,icon");
    expect(detectFavicon).toHaveBeenCalledWith("https://example.com/mcp");
  });

  it("does not apply a favicon from an outdated connection", async () => {
    let resolveFavicon!: (favicon: string) => void;
    vi.mocked(detectFavicon).mockReturnValue(
      new Promise((resolve) => {
        resolveFavicon = resolve;
      })
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404 })
    );
    const setServerInfo = vi.fn();
    let isCurrent = true;

    const loading = loadServerIcon({
      serverInfo: {
        name: "old-server",
        icons: [{ src: "https://old.example.com/icon.svg" }],
      },
      url: "https://old.example.com/mcp",
      isMounted: () => true,
      isCurrent: () => isCurrent,
      setServerInfo,
      addLog: vi.fn(),
    });

    isCurrent = false;
    resolveFavicon("data:image/png;base64,old-icon");

    expect(await loading).toBeNull();
    expect(setServerInfo).not.toHaveBeenCalled();
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
