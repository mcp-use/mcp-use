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

describe("isEqualDeep", () => {
  it("compares primitives correctly", async () => {
    const { isEqualDeep } =
      await import("../../../src/react/useMcp-helpers.js");
    expect(isEqualDeep(1, 1)).toBe(true);
    expect(isEqualDeep(1, 2)).toBe(false);
    expect(isEqualDeep("a", "a")).toBe(true);
    expect(isEqualDeep("a", "b")).toBe(false);
    expect(isEqualDeep(null, null)).toBe(true);
    expect(isEqualDeep(undefined, undefined)).toBe(true);
    expect(isEqualDeep(null, undefined)).toBe(false);
  });

  it("compares objects with different key order", async () => {
    const { isEqualDeep } =
      await import("../../../src/react/useMcp-helpers.js");
    expect(isEqualDeep({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(isEqualDeep({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
    expect(isEqualDeep({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("compares top-level arrays, length mismatches, and array-vs-object shapes", async () => {
    const { isEqualDeep } =
      await import("../../../src/react/useMcp-helpers.js");
    expect(isEqualDeep([1, 2], [1, 2])).toBe(true);
    expect(isEqualDeep([1, 2], [1, 2, 3])).toBe(false);
    expect(isEqualDeep([1, 2, 3], [1, 2])).toBe(false);
    expect(isEqualDeep([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(isEqualDeep({ 0: 1, 1: 2 }, [1, 2])).toBe(false);
    expect(isEqualDeep([{ id: "a" }], [{ id: "a" }])).toBe(true);
    expect(isEqualDeep([{ id: "a" }], [{ id: "b" }])).toBe(false);
  });

  it("compares nested objects and arrays", async () => {
    const { isEqualDeep } =
      await import("../../../src/react/useMcp-helpers.js");
    const obj1 = {
      name: "test",
      nested: { x: [1, 2, 3], y: "hello" },
    };
    const obj2 = {
      nested: { y: "hello", x: [1, 2, 3] },
      name: "test",
    };
    const obj3 = {
      nested: { y: "hello", x: [1, 2, 4] },
      name: "test",
    };
    expect(isEqualDeep(obj1, obj2)).toBe(true);
    expect(isEqualDeep(obj1, obj3)).toBe(false);
  });
});
