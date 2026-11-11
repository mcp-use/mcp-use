import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Node 25 defines `globalThis.localStorage` as a getter that prints a warning
// on any read (`typeof` included) unless Node runs with `--localstorage-file`.
// Stand in for it with a getter that counts reads, so this runs on any Node.
describe("telemetry in Node", () => {
  let reads: number;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    reads = 0;
    originalEnv = { ...process.env };
    // Opting in runs every opt-out check, including the localStorage fallback.
    delete process.env.MCP_USE_ANONYMIZED_TELEMETRY;
    delete process.env.MCP_USE_TELEMETRY_SOURCE;
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}"))
    );
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        reads++;
        return undefined;
      },
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("never reads the localStorage global", async () => {
    const { Tel, setTelemetrySource } =
      await import("../../../src/telemetry/telemetry-node.js");

    const telemetry = Tel.getInstance();
    setTelemetrySource("cli");
    await telemetry.capture({ name: "test_event", properties: {} });

    expect(telemetry.runtimeEnvironment).toBe("node");
    expect(telemetry.isEnabled).toBe(true);
    expect(reads).toBe(0);
  });
});
