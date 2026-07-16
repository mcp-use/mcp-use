import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

function findCapturedEvent(eventName: string): any {
  for (const call of fetchMock.mock.calls) {
    const init = call[1] as RequestInit | undefined;
    if (!init?.body || typeof init.body !== "string") continue;
    try {
      const parsed = JSON.parse(init.body);
      if (parsed?.event === eventName) return parsed;
    } catch {
      // not a JSON telemetry body
    }
  }
  return undefined;
}

describe("setProductVersion", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.MCP_USE_ANONYMIZED_TELEMETRY;
    vi.resetModules();
    vi.clearAllMocks();
    fetchMock.mockClear();
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("should use setProductVersion override in capture()", async () => {
    const { Tel, setProductVersion } =
      await import("../../../src/telemetry/telemetry.js");

    setProductVersion("9.9.9-custom");
    await Tel.getInstance().capture({
      name: "test_product_version",
      properties: { foo: "bar" },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const captureCall = findCapturedEvent("test_product_version");
    expect(captureCall).toBeDefined();
    expect(captureCall.properties.mcp_use_version).toBe("9.9.9-custom");
  });
});
