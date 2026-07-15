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

describe("McpAppRuntime (Phase 5)", () => {
  it("eagerly creates one App and registers multiple tools before connect", async () => {
    const [guestTransport, hostTransport] = createPairedTransports();
    const runtime = createMcpAppRuntime(normalizeViewConfig(), {
      transport: guestTransport,
    });
    const app = runtime.getApp();

    expect(app).not.toBeNull();
    expect(runtime.getApp()).toBe(app);

    runtime.registerViewTool("first", {}, async () => ({
      content: [{ type: "text" as const, text: "one" }],
    }));
    runtime.registerViewTool("second", {}, async () => ({
      content: [{ type: "text" as const, text: "two" }],
    }));

    const bridge = new AppBridge(
      null,
      { name: "test-host", version: "1.0.0" },
      { openLinks: {}, serverTools: {} }
    );
    const init = new Promise<void>((resolve) => {
      bridge.oninitialized = () => resolve();
    });
    await bridge.connect(hostTransport);
    const connected = await runtime.connect();
    await init;

    expect(connected).toBe(app);
    expect(runtime.getApp()).toBe(app);
    expect((await bridge.listTools({})).tools.map((tool) => tool.name)).toEqual(
      ["first", "second"]
    );
    await expect(
      bridge.callTool({ name: "first", arguments: {} })
    ).resolves.toMatchObject({ content: [{ text: "one" }] });
    await expect(
      bridge.callTool({ name: "second", arguments: {} })
    ).resolves.toMatchObject({ content: [{ text: "two" }] });

    await runtime.dispose();
  });

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

  it("registers tools while connection is in flight", async () => {
    const [guestTransport, hostTransport] = createPairedTransports();
    const originalStart = guestTransport.start.bind(guestTransport);
    let releaseStart: (() => void) | undefined;
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    guestTransport.start = async () => {
      await startGate;
      await originalStart();
    };
    const runtime = createMcpAppRuntime(normalizeViewConfig(), {
      transport: guestTransport,
    });
    const app = runtime.getApp();
    expect(app).not.toBeNull();

    const bridge = new AppBridge(
      null,
      { name: "test-host", version: "1.0.0" },
      { openLinks: {}, serverTools: {} }
    );
    const init = new Promise<void>((resolve) => {
      bridge.oninitialized = () => resolve();
    });
    await bridge.connect(hostTransport);
    const connection = runtime.connect();

    runtime.registerViewTool("during-init", {}, async () => ({
      content: [{ type: "text" as const, text: "ready" }],
    }));
    const listLocally = app!.onlisttools as unknown as () => Promise<{
      tools: { name: string }[];
    }>;
    expect((await listLocally()).tools.map((tool) => tool.name)).toEqual([
      "during-init",
    ]);

    releaseStart?.();
    await connection;
    await init;
    expect((await bridge.listTools({})).tools.map((tool) => tool.name)).toEqual(
      ["during-init"]
    );

    await runtime.dispose();
  });

  it("caches one terminal connection failure and retains the same App", async () => {
    const failError = new Error("inject-fail");
    let startCount = 0;
    const transport = createFailingTransport(failError);
    const originalStart = transport.start.bind(transport);
    transport.start = async () => {
      startCount += 1;
      await originalStart();
    };
    const runtime = createMcpAppRuntime(normalizeViewConfig(), { transport });
    const app = runtime.getApp();
    expect(app).not.toBeNull();

    const first = runtime.connect();
    const second = runtime.connect();
    expect(second).toBe(first);
    await expect(first).rejects.toThrow(
      /inject-fail|already connected|invalid/i
    );
    await expect(second).rejects.toThrow(
      /inject-fail|already connected|invalid/i
    );

    const third = runtime.connect();
    expect(third).toBe(first);
    await expect(third).rejects.toThrow(
      /inject-fail|already connected|invalid/i
    );
    expect(startCount).toBe(1);
    expect(runtime.getApp()).toBe(app);
    expect(runtime.getHostSnapshot()).toMatchObject({
      isConnected: false,
      connectionError: expect.any(Error),
    });

    runtime.registerViewTool("after-failure", {}, async () => ({
      content: [{ type: "text" as const, text: "still registered" }],
    }));
    const listLocally = app!.onlisttools as unknown as () => Promise<{
      tools: { name: string }[];
    }>;
    expect((await listLocally()).tools.map((tool) => tool.name)).toEqual([
      "after-failure",
    ]);

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
