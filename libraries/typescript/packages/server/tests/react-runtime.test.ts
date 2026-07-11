// @vitest-environment happy-dom
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { normalizeViewConfig } from "../src/react/runtime/view-config.js";
import {
  createMcpAppRuntime,
  type ViewRuntimeTransport,
} from "../src/react/runtime/view-runtime.js";
import { createPairedTransports } from "./helpers/paired-transport.js";

function createFailingTransport(error: Error): ViewRuntimeTransport {
  return {
    async start() {},
    async send() {
      throw error;
    },
    async close() {},
  } as ViewRuntimeTransport;
}

/**
 * Transport that rejects `start()` after `fail()` so connect can be
 * superseded mid-flight.
 */
function createDeferredFailTransport(error: Error): {
  transport: ViewRuntimeTransport;
  fail: () => void;
} {
  let rejectStart: ((err: Error) => void) | undefined;
  const transport = {
    async start() {
      await new Promise<void>((_resolve, reject) => {
        rejectStart = reject;
      });
    },
    async send() {},
    async close() {},
  } as ViewRuntimeTransport;

  return {
    transport,
    fail() {
      rejectStart?.(error);
    },
  };
}

describe("McpAppRuntime (Phase 5)", () => {
  it("serves an empty tools list before any registerViewTool", async () => {
    const [guestTransport, hostTransport] = createPairedTransports();
    const runtime = createMcpAppRuntime(normalizeViewConfig(), {
      transport: guestTransport,
    });

    const bridge = new AppBridge(
      null,
      { name: "test-host", version: "1.0.0" },
      { openLinks: {}, serverTools: {} }
    );
    const init = new Promise<void>((resolve) => {
      bridge.oninitialized = () => resolve();
    });
    await bridge.connect(hostTransport);
    await runtime.connect();
    await init;

    const listed = await bridge.listTools({});
    expect(listed.tools).toEqual([]);

    await runtime.dispose();
  });

  it("first registerViewTool handoff makes the tool visible and emits list_changed", async () => {
    const [guestTransport, hostTransport] = createPairedTransports();
    const runtime = createMcpAppRuntime(normalizeViewConfig(), {
      transport: guestTransport,
    });

    const bridge = new AppBridge(
      null,
      { name: "test-host", version: "1.0.0" },
      { openLinks: {}, serverTools: {} }
    );

    let listChangedCount = 0;
    bridge.fallbackNotificationHandler = async (notification) => {
      if (notification.method === "notifications/tools/list_changed") {
        listChangedCount += 1;
      }
    };

    const init = new Promise<void>((resolve) => {
      bridge.oninitialized = () => resolve();
    });
    await bridge.connect(hostTransport);
    await runtime.connect();
    await init;

    expect((await bridge.listTools({})).tools).toEqual([]);

    runtime.registerViewTool(
      "pick-item",
      {
        description: "Pick an item",
        inputSchema: z.object({ id: z.string() }),
      },
      (async (args: { id: string }) => ({
        content: [{ type: "text" as const, text: args.id }],
      })) as never
    );

    await expect
      .poll(async () => (await bridge.listTools({})).tools.map((t) => t.name))
      .toEqual(["pick-item"]);
    expect(listChangedCount).toBe(1);

    const result = await bridge.callTool({
      name: "pick-item",
      arguments: { id: "x" },
    });
    expect(result.content?.[0]).toMatchObject({ text: "x" });

    await runtime.dispose();
  });

  it("failed connection followed by successful retry creates a fresh App", async () => {
    const failError = new Error("inject-fail");
    const runtime = createMcpAppRuntime(normalizeViewConfig(), {
      transport: createFailingTransport(failError),
    });

    await expect(runtime.connect()).rejects.toThrow(/inject-fail|already connected|invalid/i);
    expect(runtime.getHostSnapshot().isConnected).toBe(false);
    expect(runtime.getHostSnapshot().connectionError).toBeInstanceOf(Error);
    expect(runtime.getApp()).toBeNull();

    const [guestTransport, hostTransport] = createPairedTransports();
    runtime.setTransport(guestTransport);

    const bridge = new AppBridge(
      null,
      { name: "test-host", version: "1.0.0" },
      { openLinks: {}, serverTools: {} }
    );
    const init = new Promise<void>((resolve) => {
      bridge.oninitialized = () => resolve();
    });
    await bridge.connect(hostTransport);

    const app = await runtime.connect();
    await init;
    expect(runtime.getHostSnapshot().isConnected).toBe(true);
    expect(runtime.getHostSnapshot().connectionError).toBeUndefined();
    expect(runtime.getApp()).toBe(app);

    await runtime.dispose();
  });

  it("an old generation's late failure does not affect a newer generation", async () => {
    const { transport: hangingTransport, fail } = createDeferredFailTransport(
      new Error("late-fail")
    );
    const runtime = createMcpAppRuntime(normalizeViewConfig(), {
      transport: hangingTransport,
    });

    const first = runtime.connect();
    // Let connect enter transport.start before we dispose / retry.
    await new Promise((resolve) => setTimeout(resolve, 10));

    await runtime.dispose();

    // Late failure from the disposed generation must not resurrect state.
    fail();
    await expect(first).rejects.toThrow();

    expect(runtime.getApp()).toBeNull();
    await expect(runtime.connect()).rejects.toThrow(/disposed/);
  });

  it("old generation late completion does not replace a newer connected App", async () => {
    let releaseClose: (() => void) | undefined;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });

    const failingTransport = {
      async start() {},
      async send() {
        throw new Error("gen1-fail");
      },
      async close() {
        await closeGate;
      },
    } as ViewRuntimeTransport;

    const runtime = createMcpAppRuntime(normalizeViewConfig(), {
      transport: failingTransport,
    });

    const first = runtime.connect();
    // Failure clears connectPromise then awaits transport.close (gated). Wait
    // until gen1 is parked in cleanup so gen2 can start.
    await new Promise((resolve) => setTimeout(resolve, 30));

    const [guestTransport, hostTransport] = createPairedTransports();
    runtime.setTransport(guestTransport);

    const bridge = new AppBridge(
      null,
      { name: "test-host", version: "1.0.0" },
      { openLinks: {}, serverTools: {} }
    );
    const init = new Promise<void>((resolve) => {
      bridge.oninitialized = () => resolve();
    });
    await bridge.connect(hostTransport);

    const app2Promise = runtime.connect();
    releaseClose?.();
    const app2 = await app2Promise;
    await init;
    await expect(first).rejects.toThrow(/gen1-fail/);

    expect(runtime.getApp()).toBe(app2);
    expect(runtime.getHostSnapshot().isConnected).toBe(true);
    expect((await bridge.listTools({})).tools).toEqual([]);

    await runtime.dispose();
  });

  it("dispose closes the App and rejects subsequent connect", async () => {
    const [guestTransport, hostTransport] = createPairedTransports();
    const runtime = createMcpAppRuntime(normalizeViewConfig(), {
      transport: guestTransport,
    });

    const bridge = new AppBridge(
      null,
      { name: "test-host", version: "1.0.0" },
      { openLinks: {}, serverTools: {} }
    );
    const init = new Promise<void>((resolve) => {
      bridge.oninitialized = () => resolve();
    });
    await bridge.connect(hostTransport);
    await runtime.connect();
    await init;

    await runtime.dispose();
    expect(runtime.getApp()).toBeNull();
    expect(runtime.getHostSnapshot().isConnected).toBe(false);
    await expect(runtime.connect()).rejects.toThrow(/disposed/);
  });
});
