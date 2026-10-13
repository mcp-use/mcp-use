// @vitest-environment happy-dom
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDeepLink } from "../src/react/index.js";
import { ViewRuntimeProvider } from "../src/react/runtime/view-runtime-context.js";
import { normalizeViewConfig } from "../src/react/runtime/view-config.js";
import {
  createMcpAppRuntime,
  type McpAppRuntime,
} from "../src/react/runtime/view-runtime.js";
import { createPairedTransports } from "./helpers/paired-transport.js";

const runtimes: McpAppRuntime[] = [];
const bridges: AppBridge[] = [];

afterEach(async () => {
  cleanup();
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()));
});

async function setup(hostContext: McpUiHostContext = {}) {
  const [guestTransport, hostTransport] = createPairedTransports();
  const start = vi.spyOn(guestTransport, "start");
  const runtime = createMcpAppRuntime(normalizeViewConfig(), {
    transport: guestTransport,
  });
  runtimes.push(runtime);
  // Deep links are host context, with no separate capability required.
  const bridge = new AppBridge(
    null,
    { name: "test-host", version: "1.0.0" },
    {},
    { hostContext }
  );
  bridges.push(bridge);
  await bridge.connect(hostTransport);
  return { runtime, bridge, start };
}

function Probe({ onRender }: { onRender?: () => void }) {
  const { url } = useDeepLink();
  onRender?.();
  return <div data-testid="url">{url ?? "no link"}</div>;
}

function mount(runtime: McpAppRuntime, onRender?: () => void) {
  return render(
    <StrictMode>
      <ViewRuntimeProvider runtime={runtime}>
        <Probe {...(onRender && { onRender })} />
      </ViewRuntimeProvider>
    </StrictMode>
  );
}

describe("useDeepLink", () => {
  it("reads the initial URL after the single connection without a notification", async () => {
    const { runtime, start } = await setup({
      "openai/deepLink": { url: "/parts?tag=bolt&sort=asc" },
    });
    mount(runtime);
    expect(screen.getByTestId("url").textContent).toBe("no link");

    await act(async () => {
      await Promise.all([runtime.connect(), runtime.connect()]);
    });

    expect(screen.getByTestId("url").textContent).toBe(
      "/parts?tag=bolt&sort=asc"
    );
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("follows replacement URLs, keeps URLs across unrelated patches, and clears invalid state", async () => {
    const { runtime, bridge } = await setup({
      "openai/deepLink": { url: "/parts" },
    });
    await runtime.connect();
    const onRender = vi.fn();
    mount(runtime, onRender);
    const renders = onRender.mock.calls.length;

    await act(async () => {
      await bridge.sendHostContextChange({ theme: "dark" });
    });
    expect(screen.getByTestId("url").textContent).toBe("/parts");
    expect(onRender).toHaveBeenCalledTimes(renders);

    await act(async () => {
      await bridge.sendHostContextChange({
        "openai/deepLink": { url: "/parts/hex-bolt?size=M6" },
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("url").textContent).toBe(
        "/parts/hex-bolt?size=M6"
      );
    });
    await act(async () => {
      await bridge.sendHostContextChange({ "openai/deepLink": null });
    });
    expect(screen.getByTestId("url").textContent).toBe("no link");
  });

  it("returns undefined on hosts without deep links and tolerates malformed state", async () => {
    const { runtime, bridge, start } = await setup();
    await runtime.connect();
    mount(runtime);
    expect(screen.getByTestId("url").textContent).toBe("no link");

    for (const state of ["/parts", {}, { url: 42 }, ["/parts"]]) {
      await act(async () => {
        await bridge.sendHostContextChange({ "openai/deepLink": state });
      });
      expect(screen.getByTestId("url").textContent).toBe("no link");
    }
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("normalizes older host path/query payloads like the official getter", async () => {
    const { runtime, bridge } = await setup({
      "openai/deepLink": {
        path: ["parts", "hex bolt/large"],
        query: [
          ["tag", "a&b"],
          ["tag", "bolt"],
        ],
      },
    });
    await runtime.connect();
    mount(runtime);
    expect(screen.getByTestId("url").textContent).toBe(
      "/parts/hex%20bolt%2Flarge?tag=a%26b&tag=bolt"
    );

    for (const state of [
      { path: ["parts", 42], query: [] },
      { path: ["parts"], query: [["tag"]] },
      { path: ["parts"], query: [["tag", 42]] },
    ]) {
      await act(async () => {
        await bridge.sendHostContextChange({ "openai/deepLink": state });
      });
      expect(screen.getByTestId("url").textContent).toBe("no link");
    }

    await act(async () => {
      await bridge.sendHostContextChange({
        "openai/deepLink": { url: "/modern", path: ["old"], query: [] },
      });
    });
    expect(screen.getByTestId("url").textContent).toBe("/modern");
  });

  it("cleans subscriptions in StrictMode and reads fresh state when remounted", async () => {
    const { runtime, bridge, start } = await setup({
      "openai/deepLink": { url: "/first" },
    });
    await runtime.connect();
    const originalSubscribe = runtime.subscribeHost;
    let activeSubscriptions = 0;
    runtime.subscribeHost = (listener) => {
      activeSubscriptions += 1;
      const unsubscribe = originalSubscribe(listener);
      return () => {
        activeSubscriptions -= 1;
        unsubscribe();
      };
    };
    const onRender = vi.fn();
    const firstMount = mount(runtime, onRender);
    expect(activeSubscriptions).toBe(1);
    firstMount.unmount();
    expect(activeSubscriptions).toBe(0);
    const renders = onRender.mock.calls.length;

    await bridge.sendHostContextChange({
      "openai/deepLink": { url: "/second" },
    });
    expect(onRender).toHaveBeenCalledTimes(renders);
    mount(runtime);
    expect(screen.getByTestId("url").textContent).toBe("/second");
    expect(activeSubscriptions).toBe(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("does not retain a disposed view's URL in a fresh runtime", async () => {
    const first = await setup({ "openai/deepLink": { url: "/old" } });
    await first.runtime.connect();
    const firstMount = mount(first.runtime);
    expect(screen.getByTestId("url").textContent).toBe("/old");
    firstMount.unmount();
    await first.runtime.dispose();
    expect(first.runtime.getHostSnapshot().hostContext).toBeUndefined();

    const second = await setup();
    await second.runtime.connect();
    mount(second.runtime);
    expect(screen.getByTestId("url").textContent).toBe("no link");
  });
});
