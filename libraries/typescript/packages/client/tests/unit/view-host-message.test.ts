// @vitest-environment jsdom
import { App } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { beforeAll, describe, expect, it } from "vitest";

import { createPairedTransports } from "../helpers/paired-transport.js";

/** Mirrors ViewRenderer DEFAULT_HOST_CAPABILITIES (including message). */
const VIEW_RENDERER_HOST_CAPABILITIES = {
  openLinks: {},
  serverTools: {},
  serverResources: {},
  logging: {},
  updateModelContext: { text: {} },
  message: { text: {} },
} as const;

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  globalThis.ResizeObserver =
    ResizeObserverMock as unknown as typeof ResizeObserver;
});

describe("ViewRenderer host message capability", () => {
  it("allows guest sendMessage when defaults include message and onMessage is wired", async () => {
    const [guestTransport, hostTransport] = createPairedTransports();
    const app = new App({ name: "test-view", version: "1.0.0" }, { tools: {} });

    const bridge = new AppBridge(
      null,
      { name: "mcp-use-client", version: "2.0.0" },
      { ...VIEW_RENDERER_HOST_CAPABILITIES }
    );

    let received: string | undefined;
    bridge.onmessage = async ({ content }) => {
      const block = content?.[0];
      received =
        block && "text" in block && typeof block.text === "string"
          ? block.text
          : undefined;
      return {};
    };

    const init = new Promise<void>((resolve) => {
      bridge.oninitialized = () => resolve();
    });

    await Promise.all([
      app.connect(guestTransport),
      bridge.connect(hostTransport),
    ]);
    await init;

    await app.sendMessage({
      role: "user",
      content: [{ type: "text", text: "follow-up from view" }],
    });

    expect(received).toBe("follow-up from view");

    await Promise.all([app.close(), bridge.close()]);
  });
});
