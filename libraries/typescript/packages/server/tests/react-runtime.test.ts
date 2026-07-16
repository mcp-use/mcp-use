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

    await expect(runtime.connect()).rejects.toThrow(
      /inject-fail|already connected|invalid/i
    );
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

describe("McpAppRuntime capability checks (Phase 9)", () => {
  it("callServerTool rejects when host lacks serverTools", async () => {
    const [guestTransport, hostTransport] = createPairedTransports();
    const runtime = createMcpAppRuntime(normalizeViewConfig(), {
      transport: guestTransport,
    });

    const bridge = new AppBridge(
      null,
      { name: "test-host", version: "1.0.0" },
      { openLinks: {}, message: { text: {} } }
    );

    let callToolHit = false;
    bridge.oncalltool = async () => {
      callToolHit = true;
      return {
        content: [{ type: "text", text: "ok" }],
        structuredContent: {},
      };
    };

    const init = new Promise<void>((resolve) => {
      bridge.oninitialized = () => resolve();
    });
    await bridge.connect(hostTransport);
    await runtime.connect();
    await init;

    await expect(
      runtime.callServerTool({ name: "lookup", arguments: {} })
    ).rejects.toThrow(/serverTools/);
    expect(callToolHit).toBe(false);

    await runtime.dispose();
  });

  it("sendMessage rejects when host lacks message", async () => {
    const [guestTransport, hostTransport] = createPairedTransports();
    const runtime = createMcpAppRuntime(normalizeViewConfig(), {
      transport: guestTransport,
    });

    const bridge = new AppBridge(
      null,
      { name: "test-host", version: "1.0.0" },
      { openLinks: {}, serverTools: {} }
    );

    let messageHit = false;
    bridge.onmessage = async () => {
      messageHit = true;
      return {};
    };

    const init = new Promise<void>((resolve) => {
      bridge.oninitialized = () => resolve();
    });
    await bridge.connect(hostTransport);
    await runtime.connect();
    await init;

    await expect(
      runtime.sendMessage({
        role: "user",
        content: [{ type: "text", text: "hi" }],
      })
    ).rejects.toThrow(/message/);
    expect(messageHit).toBe(false);

    await runtime.dispose();
  });

  it("openLink rejects when host lacks openLinks", async () => {
    const [guestTransport, hostTransport] = createPairedTransports();
    const runtime = createMcpAppRuntime(normalizeViewConfig(), {
      transport: guestTransport,
    });

    const bridge = new AppBridge(
      null,
      { name: "test-host", version: "1.0.0" },
      { serverTools: {}, message: { text: {} } }
    );

    let openHit = false;
    bridge.onopenlink = async () => {
      openHit = true;
      return {};
    };

    const init = new Promise<void>((resolve) => {
      bridge.oninitialized = () => resolve();
    });
    await bridge.connect(hostTransport);
    await runtime.connect();
    await init;

    await expect(
      runtime.openLink({ url: "https://example.com" })
    ).rejects.toThrow(/openLinks/);
    expect(openHit).toBe(false);

    await runtime.dispose();
  });

  it("sendMessage and openLink succeed when capabilities are present", async () => {
    const [guestTransport, hostTransport] = createPairedTransports();
    const runtime = createMcpAppRuntime(normalizeViewConfig(), {
      transport: guestTransport,
    });

    const bridge = new AppBridge(
      null,
      { name: "test-host", version: "1.0.0" },
      { openLinks: {}, serverTools: {}, message: { text: {} } }
    );

    let followUp: string | undefined;
    let opened: string | undefined;
    bridge.onmessage = async ({ content }) => {
      const block = content?.[0];
      followUp =
        block && "text" in block && typeof block.text === "string"
          ? block.text
          : undefined;
      return {};
    };
    bridge.onopenlink = async ({ url }) => {
      opened = url;
      return {};
    };

    const init = new Promise<void>((resolve) => {
      bridge.oninitialized = () => resolve();
    });
    await bridge.connect(hostTransport);
    await runtime.connect();
    await init;

    await runtime.sendMessage({
      role: "user",
      content: [{ type: "text", text: "refine" }],
    });
    await runtime.openLink({ url: "https://example.com/docs" });

    expect(followUp).toBe("refine");
    expect(opened).toBe("https://example.com/docs");

    await runtime.dispose();
  });

  it("availableDisplayModes is the intersection of view and host modes", async () => {
    const [guestTransport, hostTransport] = createPairedTransports();
    const runtime = createMcpAppRuntime(
      normalizeViewConfig({
        displayModes: ["inline", "fullscreen", "pip"],
      }),
      { transport: guestTransport }
    );

    const bridge = new AppBridge(
      null,
      { name: "test-host", version: "1.0.0" },
      { openLinks: {}, serverTools: {} },
      {
        hostContext: {
          availableDisplayModes: ["inline", "fullscreen"],
        },
      }
    );

    const init = new Promise<void>((resolve) => {
      bridge.oninitialized = () => resolve();
    });
    await bridge.connect(hostTransport);
    await runtime.connect();
    await init;

    expect(runtime.getDisplaySnapshot().availableDisplayModes).toEqual([
      "inline",
      "fullscreen",
    ]);

    await runtime.dispose();
  });

  it("host omitting availableDisplayModes exposes only inline", async () => {
    const [guestTransport, hostTransport] = createPairedTransports();
    const runtime = createMcpAppRuntime(
      normalizeViewConfig({
        displayModes: ["inline", "fullscreen", "pip"],
      }),
      { transport: guestTransport }
    );

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

    expect(runtime.getDisplaySnapshot().availableDisplayModes).toEqual([
      "inline",
    ]);

    await runtime.dispose();
  });

  it("requestDisplayMode rejects non-negotiated modes and accepts negotiated ones", async () => {
    const [guestTransport, hostTransport] = createPairedTransports();
    const runtime = createMcpAppRuntime(
      normalizeViewConfig({
        displayModes: ["inline", "fullscreen", "pip"],
      }),
      { transport: guestTransport }
    );

    const bridge = new AppBridge(
      null,
      { name: "test-host", version: "1.0.0" },
      { openLinks: {}, serverTools: {} },
      {
        hostContext: {
          availableDisplayModes: ["inline", "fullscreen"],
        },
      }
    );

    let requested: string | undefined;
    bridge.onrequestdisplaymode = async ({ mode }) => {
      requested = mode;
      return { mode };
    };

    const init = new Promise<void>((resolve) => {
      bridge.oninitialized = () => resolve();
    });
    await bridge.connect(hostTransport);
    await runtime.connect();
    await init;

    await expect(runtime.requestDisplayMode({ mode: "pip" })).rejects.toThrow(
      /pip.*negotiated available modes \[inline, fullscreen\]/
    );
    expect(requested).toBeUndefined();

    await runtime.requestDisplayMode({ mode: "fullscreen" });
    expect(requested).toBe("fullscreen");

    await runtime.dispose();
  });

  it("display channel re-derives availableDisplayModes when host modes change", async () => {
    const [guestTransport, hostTransport] = createPairedTransports();
    const runtime = createMcpAppRuntime(
      normalizeViewConfig({
        displayModes: ["inline", "fullscreen", "pip"],
      }),
      { transport: guestTransport }
    );

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

    const omitted = runtime.getDisplaySnapshot();
    expect(omitted.availableDisplayModes).toEqual(["inline"]);

    await bridge.sendHostContextChange({
      availableDisplayModes: ["inline", "fullscreen", "pip"],
    });

    await expect
      .poll(() => runtime.getDisplaySnapshot().availableDisplayModes)
      .toEqual(["inline", "fullscreen", "pip"]);
    expect(runtime.getDisplaySnapshot()).not.toBe(omitted);

    const withModes = runtime.getDisplaySnapshot();
    await bridge.sendHostContextChange({ theme: "dark" });
    // Theme-only host update must not replace the display snapshot identity.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runtime.getDisplaySnapshot()).toBe(withModes);

    await runtime.dispose();
  });
});
