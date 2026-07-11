// @vitest-environment happy-dom
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { useState, type ComponentType } from "react";

import {
  bootstrapView,
  disposeView,
  Image,
  ModelContext,
  modelContext,
  useCallTool,
  useDisplayMode,
  useHostContext,
  useOpenExternal,
  useSendFollowUp,
  useSendSizeChanged,
  useToolContext,
  useViewTheme,
  useViewTool,
} from "../src/react/index.js";
import { _resetBootstrapRootsForTesting } from "../src/react/runtime/bootstrap-view.js";
import { _resetModelContextForTesting } from "../src/react/runtime/model-context-store.js";
import {
  _getAppForTesting,
  _getRuntimeForTesting,
  _resetViewBridgeForTesting,
  _setTransportForTesting,
} from "../src/react/runtime/view-runtime.js";
import { createPairedTransports } from "./helpers/paired-transport.js";

function appOptions(app: NonNullable<ReturnType<typeof _getAppForTesting>>): {
  autoResize?: boolean;
} {
  return (app as unknown as { options: { autoResize?: boolean } }).options;
}

function appCapabilities(
  app: NonNullable<ReturnType<typeof _getAppForTesting>>
): {
  availableDisplayModes?: readonly string[];
} {
  return (
    app as unknown as {
      _capabilities: { availableDisplayModes?: readonly string[] };
    }
  )._capabilities;
}

function resetRuntime(): void {
  // disposeView first: unmount React, then close the App (real disposal path).
  _resetBootstrapRootsForTesting();
  _resetViewBridgeForTesting();
  _resetModelContextForTesting();
  document.body.innerHTML = "";
}

async function startHost(
  onCallTool?: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<unknown>,
  capabilities: ConstructorParameters<typeof AppBridge>[2] = {
    openLinks: {},
    serverTools: {},
    logging: {},
    updateModelContext: { text: {} },
  }
) {
  const [guestTransport, hostTransport] = createPairedTransports();
  _setTransportForTesting(guestTransport);

  const bridge = new AppBridge(
    null,
    { name: "test-host", version: "1.0.0" },
    capabilities
  );

  bridge.oncalltool = async ({ name, arguments: args }) => {
    if (!onCallTool) {
      return {
        content: [{ type: "text", text: "no handler" }],
        structuredContent: {},
      };
    }
    return (await onCallTool(name, args ?? {})) as {
      content: { type: "text"; text: string }[];
      structuredContent: Record<string, unknown>;
    };
  };

  const modelContextUpdates: {
    content?: { type: string; text?: string }[];
  }[] = [];
  bridge.onupdatemodelcontext = async (params) => {
    modelContextUpdates.push(
      params as {
        content?: { type: string; text?: string }[];
      }
    );
    return {};
  };

  const init = new Promise<void>((resolve) => {
    bridge.oninitialized = () => {
      resolve();
    };
  });

  await bridge.connect(hostTransport);
  return { bridge, init, modelContextUpdates };
}

describe("react bridge runtime", () => {
  it("mounts the default export immediately and transitions useToolContext pending → streaming → ready", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      const handle = useToolContext();
      if (handle.status === "ready") {
        const { query, items } = handle.toolOutput as {
          query: string;
          items: string[];
        };
        return (
          <div data-testid="view">
            {query}:{items.join(",")}
            <span data-testid="content">{handle.content?.[0]?.type ?? ""}</span>
            <span data-testid="meta">{handle.meta ? JSON.stringify(handle.meta) : ""}</span>
          </div>
        );
      }
      return (
        <div data-testid="lifecycle">
          {handle.status}-
          {(handle.toolInput as { query?: string } | undefined)?.query ?? ""}
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("pending-");
    });

    await bridge.sendToolInputPartial({ arguments: { query: "ap" } });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("streaming-ap");
    });

    await bridge.sendToolInput({ arguments: { query: "apple" } });
    await bridge.sendToolResult({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { query: "apple", items: ["a", "b"] },
      _meta: { trace: "view-only" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("view").textContent).toContain("apple:a,b");
      expect(screen.getByTestId("content").textContent).toBe("text");
      expect(screen.getByTestId("meta").textContent).toContain("view-only");
    });
    expect(screen.queryByTestId("lifecycle")).toBeNull();
  });

  it("streams toolInput through partial → complete → ready with status streaming → pending → ready", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      const handle = useToolContext();
      return (
        <div data-testid="lifecycle">
          {handle.status}|
          {(handle.toolInput as { query?: string } | undefined)?.query ?? ""}
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("pending|");
    });

    await bridge.sendToolInputPartial({ arguments: { query: "a" } });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("streaming|a");
    });

    await bridge.sendToolInputPartial({ arguments: { query: "ap" } });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("streaming|ap");
    });

    await bridge.sendToolInput({ arguments: { query: "apple" } });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("pending|apple");
    });

    await bridge.sendToolResult({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { query: "apple", items: ["a"] },
    });

    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("ready|apple");
    });
  });

  it("surfaces cancelled status with reason and last partial toolInput", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      const handle = useToolContext();
      return (
        <div data-testid="lifecycle">
          {handle.status}|
          {(handle.toolInput as { query?: string } | undefined)?.query ?? ""}|
          {handle.status === "cancelled" ? (handle.reason ?? "none") : ""}
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await bridge.sendToolInputPartial({ arguments: { query: "ap" } });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("streaming|ap|");
    });

    await bridge.sendToolCancelled({ reason: "user action" });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe(
        "cancelled|ap|user action"
      );
    });
  });

  it("preserves prior toolName from hostContext across tool results", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      const handle = useToolContext();
      return (
        <div data-testid="lifecycle">
          {handle.status}|{handle.toolName ?? "undef"}
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await bridge.sendHostContextChange({
      toolInfo: {
        tool: {
          name: "save-checkpoint",
          inputSchema: { type: "object", properties: {} },
        },
      },
    });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe(
        "pending|save-checkpoint"
      );
    });

    await bridge.sendToolResult({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { n: 1 },
    });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe(
        "ready|save-checkpoint"
      );
    });

    // Next call cycle: complete input clears result → pending, toolName kept.
    await bridge.sendToolInput({ arguments: {} });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe(
        "pending|save-checkpoint"
      );
    });

    await bridge.sendToolResult({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { n: 2 },
    });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe(
        "ready|save-checkpoint"
      );
    });
  });

  it("updates toolName from host-context toolInfo before a result", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      const handle = useToolContext();
      return (
        <div data-testid="lifecycle">
          {handle.status}|{handle.toolName ?? "undef"}
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("pending|undef");
    });

    await bridge.sendHostContextChange({
      toolInfo: {
        tool: {
          name: "x",
          inputSchema: { type: "object", properties: {} },
        },
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("pending|x");
    });
  });

  it("_resetViewBridgeForTesting clears toolName to undefined", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      const handle = useToolContext();
      return (
        <div data-testid="lifecycle">
          {handle.status}|{handle.toolName ?? "undef"}
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await bridge.sendHostContextChange({
      toolInfo: {
        tool: {
          name: "save-checkpoint",
          inputSchema: { type: "object", properties: {} },
        },
      },
    });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe(
        "pending|save-checkpoint"
      );
    });

    resetRuntime();
    const { init: init2 } = await startHost();
    bootstrapView({ default: View as ComponentType });
    await init2;

    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("pending|undef");
    });
  });

  it("surfaces cancelled status with undefined reason when host omits it", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      const handle = useToolContext();
      return (
        <div data-testid="lifecycle">
          {handle.status}|
          {handle.status === "cancelled"
            ? handle.reason === undefined
              ? "undef"
              : handle.reason
            : ""}
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await bridge.sendToolCancelled({});
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("cancelled|undef");
    });
  });

  it("post-cancel retry: new tool-input-partial returns to streaming then ready", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      const handle = useToolContext();
      if (handle.status === "ready") {
        const { query } = handle.toolOutput as { query: string };
        return <div data-testid="lifecycle">ready|{query}</div>;
      }
      return (
        <div data-testid="lifecycle">
          {handle.status}|
          {(handle.toolInput as { query?: string } | undefined)?.query ?? ""}
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await bridge.sendToolInputPartial({ arguments: { query: "ap" } });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("streaming|ap");
    });

    await bridge.sendToolCancelled({ reason: "user action" });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("cancelled|ap");
    });

    await bridge.sendToolInputPartial({ arguments: { query: "or" } });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("streaming|or");
    });

    await bridge.sendToolInput({ arguments: { query: "orange" } });
    await bridge.sendToolResult({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { query: "orange", items: ["o"] },
    });

    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("ready|orange");
    });
  });

  it("post-ready second call: tool-input clears ready, cancel surfaces, then new result", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      const handle = useToolContext();
      if (handle.status === "ready") {
        const { query } = handle.toolOutput as { query: string };
        return <div data-testid="lifecycle">ready|{query}</div>;
      }
      return (
        <div data-testid="lifecycle">
          {handle.status}|
          {(handle.toolInput as { query?: string } | undefined)?.query ?? ""}|
          {handle.status === "cancelled" ? (handle.reason ?? "") : ""}
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await bridge.sendToolInput({ arguments: { query: "apple" } });
    await bridge.sendToolResult({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { query: "apple", items: ["a"] },
    });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("ready|apple");
    });

    // Second call without partials: tool-input after a delivered result clears
    // result state → pending.
    await bridge.sendToolInput({ arguments: { query: "banana" } });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("pending|banana|");
    });

    await bridge.sendToolCancelled({ reason: "retry aborted" });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe(
        "cancelled|banana|retry aborted"
      );
    });

    await bridge.sendToolInputPartial({ arguments: { query: "ch" } });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("streaming|ch|");
    });

    await bridge.sendToolInput({ arguments: { query: "cherry" } });
    await bridge.sendToolResult({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { query: "cherry", items: ["c"] },
    });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("ready|cherry");
    });
  });

  it("useHostContext and useDisplayMode do not re-render on tool-input-partial", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    let hostRenders = 0;
    let displayRenders = 0;

    function HostProbe() {
      hostRenders += 1;
      const { theme, isAvailable } = useHostContext();
      return (
        <div data-testid="host">
          {theme}|{String(isAvailable)}|{hostRenders}
        </div>
      );
    }

    function DisplayProbe() {
      displayRenders += 1;
      const { displayMode } = useDisplayMode();
      return (
        <div data-testid="display">
          {displayMode}|{displayRenders}
        </div>
      );
    }

    // The tool-context consumer is a sibling leaf: the parent never
    // re-renders, so any probe re-render comes from its own subscription.
    function LifecycleProbe() {
      const handle = useToolContext();
      return <div data-testid="lifecycle">{handle.status}</div>;
    }

    function View() {
      return (
        <div>
          <HostProbe />
          <DisplayProbe />
          <LifecycleProbe />
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(() => {
      expect(screen.getByTestId("host").textContent).toContain("true");
      expect(screen.getByTestId("lifecycle").textContent).toBe("pending");
    });

    const hostRendersAfterConnect = hostRenders;
    const displayRendersAfterConnect = displayRenders;

    await bridge.sendToolInputPartial({ arguments: { query: "a" } });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("streaming");
    });
    await bridge.sendToolInputPartial({ arguments: { query: "ap" } });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("streaming");
    });

    expect(hostRenders).toBe(hostRendersAfterConnect);
    expect(displayRenders).toBe(displayRendersAfterConnect);

    await bridge.sendHostContextChange({
      theme: "dark",
      displayMode: "fullscreen",
    });
    await waitFor(() => {
      expect(screen.getByTestId("host").textContent).toContain("dark");
      expect(screen.getByTestId("display").textContent).toContain("fullscreen");
    });
    expect(hostRenders).toBeGreaterThan(hostRendersAfterConnect);
    expect(displayRenders).toBeGreaterThan(displayRendersAfterConnect);
  });

  it("host changes do not rerender tool-only consumers", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    let toolRenders = 0;

    function ToolProbe() {
      toolRenders += 1;
      const handle = useToolContext();
      return (
        <div data-testid="tool">
          {handle.status}|{toolRenders}
        </div>
      );
    }

    function HostProbe() {
      const { theme, displayMode } = useHostContext();
      return (
        <div data-testid="host">
          {theme}|{displayMode}
        </div>
      );
    }

    function View() {
      return (
        <div>
          <ToolProbe />
          <HostProbe />
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(() => {
      expect(screen.getByTestId("tool").textContent).toContain("pending");
    });
    const toolRendersAfterConnect = toolRenders;

    await bridge.sendHostContextChange({
      theme: "dark",
      displayMode: "fullscreen",
    });
    await waitFor(() => {
      expect(screen.getByTestId("host").textContent).toBe("dark|fullscreen");
    });

    expect(toolRenders).toBe(toolRendersAfterConnect);
  });

  it("tool changes do not rerender host, theme, display, or action-only consumers", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    let hostRenders = 0;
    let themeRenders = 0;
    let displayRenders = 0;
    let actionRenders = 0;

    function HostProbe() {
      hostRenders += 1;
      const { theme, isAvailable } = useHostContext();
      return (
        <div data-testid="host">
          {theme}|{String(isAvailable)}|{hostRenders}
        </div>
      );
    }

    function ThemeProbe() {
      themeRenders += 1;
      const theme = useViewTheme();
      return (
        <div data-testid="theme">
          {theme}|{themeRenders}
        </div>
      );
    }

    function DisplayProbe() {
      displayRenders += 1;
      const { displayMode } = useDisplayMode();
      return (
        <div data-testid="display">
          {displayMode}|{displayRenders}
        </div>
      );
    }

    function ActionProbe() {
      actionRenders += 1;
      const openExternal = useOpenExternal();
      const sendFollowUp = useSendFollowUp();
      const sendSizeChanged = useSendSizeChanged();
      return (
        <div data-testid="actions">
          {actionRenders}|{typeof openExternal}|{typeof sendFollowUp}|
          {typeof sendSizeChanged}
        </div>
      );
    }

    function ToolProbe() {
      const handle = useToolContext();
      return <div data-testid="tool">{handle.status}</div>;
    }

    function View() {
      return (
        <div>
          <HostProbe />
          <ThemeProbe />
          <DisplayProbe />
          <ActionProbe />
          <ToolProbe />
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(() => {
      expect(screen.getByTestId("host").textContent).toContain("true");
      expect(screen.getByTestId("tool").textContent).toBe("pending");
    });

    const hostAfter = hostRenders;
    const themeAfter = themeRenders;
    const displayAfter = displayRenders;
    const actionAfter = actionRenders;

    await bridge.sendToolInput({ arguments: { query: "apple" } });
    await bridge.sendToolResult({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { query: "apple", items: ["a"] },
    });
    await waitFor(() => {
      expect(screen.getByTestId("tool").textContent).toBe("ready");
    });

    expect(hostRenders).toBe(hostAfter);
    expect(themeRenders).toBe(themeAfter);
    expect(displayRenders).toBe(displayAfter);
    expect(actionRenders).toBe(actionAfter);
  });

  it("theme-only consumer does not rerender on locale or dimension changes", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    let themeRenders = 0;
    let hostRenders = 0;

    function ThemeProbe() {
      themeRenders += 1;
      const theme = useViewTheme();
      return (
        <div data-testid="theme">
          {theme}|{themeRenders}
        </div>
      );
    }

    function HostProbe() {
      hostRenders += 1;
      const { locale } = useHostContext();
      return (
        <div data-testid="host">
          {locale}|{hostRenders}
        </div>
      );
    }

    function View() {
      return (
        <div>
          <ThemeProbe />
          <HostProbe />
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toContain("light");
    });
    const themeAfterConnect = themeRenders;

    await bridge.sendHostContextChange({
      locale: "fr-FR",
      containerDimensions: { width: 400, height: 300 },
    });
    await waitFor(() => {
      expect(screen.getByTestId("host").textContent).toContain("fr-FR");
    });

    expect(themeRenders).toBe(themeAfterConnect);

    await bridge.sendHostContextChange({ theme: "dark" });
    await waitFor(() => {
      expect(screen.getByTestId("theme").textContent).toContain("dark");
    });
    expect(themeRenders).toBeGreaterThan(themeAfterConnect);
  });

  it("action hooks return referentially stable callbacks across rerenders", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    const refs: {
      openExternal?: (args: { url: string }) => void;
      sendFollowUp?: (args: { prompt: string }) => Promise<void>;
      sendSizeChanged?: (size: {
        width?: number;
        height?: number;
      }) => Promise<void>;
      requestDisplayMode?: (args: {
        mode: "inline" | "fullscreen" | "pip";
      }) => Promise<void>;
    } = {};

    function Probe() {
      const openExternal = useOpenExternal();
      const sendFollowUp = useSendFollowUp();
      const sendSizeChanged = useSendSizeChanged();
      const { displayMode, requestDisplayMode } = useDisplayMode();
      const { theme } = useHostContext();

      if (refs.openExternal === undefined) {
        refs.openExternal = openExternal;
        refs.sendFollowUp = sendFollowUp;
        refs.sendSizeChanged = sendSizeChanged;
        refs.requestDisplayMode = requestDisplayMode;
      }

      return (
        <div data-testid="stable">
          {theme}|{displayMode}|
          {String(refs.openExternal === openExternal)}|
          {String(refs.sendFollowUp === sendFollowUp)}|
          {String(refs.sendSizeChanged === sendSizeChanged)}|
          {String(refs.requestDisplayMode === requestDisplayMode)}
        </div>
      );
    }

    bootstrapView({ default: Probe as ComponentType });
    await init;

    await waitFor(() => {
      expect(screen.getByTestId("stable").textContent).toContain("light");
    });

    await bridge.sendHostContextChange({
      theme: "dark",
      displayMode: "fullscreen",
    });
    await waitFor(() => {
      expect(screen.getByTestId("stable").textContent).toContain("dark");
      expect(screen.getByTestId("stable").textContent).toContain("fullscreen");
    });

    expect(screen.getByTestId("stable").textContent).toBe(
      "dark|fullscreen|true|true|true|true"
    );
  });

  it("surfaces meta on useToolContext and useCallTool round-trips with state transitions", async () => {
    resetRuntime();
    const { bridge, init } = await startHost(async (name, args) => {
      if (args.id === "fail") {
        throw new Error("tool failed");
      }
      return {
        content: [{ type: "text", text: name }],
        structuredContent: { value: String(args.id ?? "") },
      };
    });

    function Probe() {
      const context = useToolContext();
      const tool = useCallTool<{ id: string }, { value: string }>("lookup");
      return (
        <div>
          <span data-testid="meta">
            {context.status === "ready" && context.meta
              ? JSON.stringify(context.meta)
              : ""}
          </span>
          <span data-testid="pending">{String(tool.isPending)}</span>
          <span data-testid="error">{tool.error?.message ?? ""}</span>
          <span data-testid="data">
            {tool.data?.structuredContent
              ? JSON.stringify(tool.data.structuredContent)
              : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              void tool.callTool({ id: "42" });
            }}
          >
            call
          </button>
          <button
            type="button"
            onClick={() => {
              void tool.callTool({ id: "fail" }).catch(() => undefined);
            }}
          >
            fail
          </button>
        </div>
      );
    }

    bootstrapView({ default: Probe as ComponentType });
    await init;

    await bridge.sendToolInput({ arguments: {} });
    await bridge.sendToolResult({
      content: [],
      structuredContent: {},
      _meta: { secret: true },
    });

    await waitFor(() => {
      expect(screen.getByTestId("meta").textContent).toContain("secret");
    });

    screen.getByText("call").click();
    await waitFor(() => {
      expect(screen.getByTestId("pending").textContent).toBe("true");
    });
    await waitFor(() => {
      expect(screen.getByTestId("data").textContent).toBe('{"value":"42"}');
      expect(screen.getByTestId("pending").textContent).toBe("false");
    });

    screen.getByText("fail").click();
    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toContain("tool failed");
    });

    screen.getByText("call").click();
    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toBe("");
    });
  });

  it("useHostContext reflects host-context notifications", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function Probe() {
      const { theme, locale, displayMode } = useHostContext();
      return (
        <div data-testid="host">
          {theme}-{locale}-{displayMode}
        </div>
      );
    }

    bootstrapView({ default: Probe as ComponentType });
    await init;

    await bridge.sendHostContextChange({
      theme: "dark",
      locale: "fr-FR",
      displayMode: "pip",
    });

    await waitFor(() => {
      expect(screen.getByTestId("host").textContent).toBe("dark-fr-FR-pip");
    });
  });

  it("useDisplayMode returns displayMode and requestDisplayMode", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    let requestedMode: string | undefined;
    bridge.onrequestdisplaymode = async ({ mode }) => {
      requestedMode = mode;
      return { mode: "fullscreen" };
    };

    function Probe() {
      const { displayMode, requestDisplayMode } = useDisplayMode();
      return (
        <div>
          <span data-testid="mode">{displayMode}</span>
          <button
            type="button"
            onClick={() => {
              void requestDisplayMode({ mode: "fullscreen" });
            }}
          >
            expand
          </button>
        </div>
      );
    }

    bootstrapView({ default: Probe as ComponentType });
    await init;

    await waitFor(() => {
      expect(screen.getByTestId("mode").textContent).toBe("inline");
    });

    screen.getByText("expand").click();
    await waitFor(() => {
      expect(requestedMode).toBe("fullscreen");
    });
  });

  it("useSendFollowUp and useOpenExternal invoke bridge actions", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    let followUpPrompt: string | undefined;
    let openedUrl: string | undefined;

    bridge.onmessage = async ({ content }) => {
      const block = content?.[0];
      followUpPrompt =
        block && "text" in block && typeof block.text === "string"
          ? block.text
          : undefined;
      return {};
    };

    bridge.onopenlink = async ({ url }) => {
      openedUrl = url;
      return {};
    };

    function Probe() {
      const sendFollowUp = useSendFollowUp();
      const openExternal = useOpenExternal();
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              void sendFollowUp({ prompt: "refine" });
            }}
          >
            follow-up
          </button>
          <button
            type="button"
            onClick={() => {
              openExternal({ url: "https://example.com" });
            }}
          >
            open
          </button>
        </div>
      );
    }

    bootstrapView({ default: Probe as ComponentType });
    await init;

    await waitFor(() => {
      expect(screen.getByText("follow-up")).not.toBeNull();
    });

    screen.getByText("follow-up").click();
    await waitFor(() => {
      expect(followUpPrompt).toBe("refine");
    });

    screen.getByText("open").click();
    await waitFor(() => {
      expect(openedUrl).toBe("https://example.com");
    });
  });

  it("viewConfig.autoResize false + useSendSizeChanged delivers manual size, no auto emit on connect", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    const sizes: { width?: number; height?: number }[] = [];
    bridge.onsizechange = (params) => {
      sizes.push(params);
    };

    function Probe() {
      const sendSizeChanged = useSendSizeChanged();
      return (
        <button
          type="button"
          onClick={() => {
            void sendSizeChanged({ width: 320, height: 240 });
          }}
        >
          resize
        </button>
      );
    }

    bootstrapView({
      default: Probe as ComponentType,
      viewConfig: { autoResize: false },
    });
    await init;

    // With autoResize disabled, connect must not emit a size-changed notification.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sizes).toHaveLength(0);

    screen.getByText("resize").click();
    await waitFor(() => {
      expect(sizes).toEqual([{ width: 320, height: 240 }]);
    });
  });

  it("viewConfig.autoResize false constructs App without auto-resize", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    const sizes: { width?: number; height?: number }[] = [];
    bridge.onsizechange = (params) => {
      sizes.push(params);
    };

    function Probe() {
      return <div data-testid="probe">ok</div>;
    }

    bootstrapView({
      default: Probe as ComponentType,
      viewConfig: { autoResize: false },
    });
    await init;

    await waitFor(() => {
      expect(screen.getByTestId("probe").textContent).toBe("ok");
    });

    // Behavioral pin: disabled auto-resize means no size-changed on connect.
    // Default-path auto emission is flaky under happy-dom (ResizeObserver /
    // rAF timing), so we pin the disabled path behaviorally and assert the
    // option via App's runtime `options` field (typed private; cast for tests).
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sizes).toHaveLength(0);

    const app = _getAppForTesting();
    expect(app).not.toBeNull();
    expect(appOptions(app!).autoResize).toBe(false);
  });

  it("default viewConfig keeps App autoResize true", async () => {
    resetRuntime();
    const { init } = await startHost();

    function Probe() {
      return <div data-testid="probe">ok</div>;
    }

    bootstrapView({ default: Probe as ComponentType });
    await init;

    await waitFor(() => {
      expect(screen.getByTestId("probe").textContent).toBe("ok");
    });

    const app = _getAppForTesting();
    expect(app).not.toBeNull();
    expect(appOptions(app!).autoResize).toBe(true);
    expect(appCapabilities(app!).availableDisplayModes).toEqual([
      "inline",
      "fullscreen",
      "pip",
    ]);
  });

  it("valid custom displayModes are normalized into App capabilities", async () => {
    resetRuntime();
    const { init } = await startHost();

    function Probe() {
      return <div data-testid="probe">ok</div>;
    }

    bootstrapView({
      default: Probe as ComponentType,
      viewConfig: { displayModes: ["inline", "fullscreen"] },
    });
    await init;

    await waitFor(() => {
      expect(screen.getByTestId("probe").textContent).toBe("ok");
    });

    const app = _getAppForTesting();
    expect(app).not.toBeNull();
    expect(appCapabilities(app!).availableDisplayModes).toEqual([
      "inline",
      "fullscreen",
    ]);
  });

  it("rejects invalid viewConfig.displayModes at bootstrap", () => {
    resetRuntime();

    function Probe() {
      return <div>ok</div>;
    }

    expect(() =>
      bootstrapView({
        default: Probe as ComponentType,
        viewConfig: { displayModes: [] },
      })
    ).toThrow(/non-empty array.*inline/);

    expect(() =>
      bootstrapView({
        default: Probe as ComponentType,
        viewConfig: { displayModes: ["inline", "inline"] },
      })
    ).toThrow(/duplicate mode "inline"/);

    expect(() =>
      bootstrapView({
        default: Probe as ComponentType,
        viewConfig: { displayModes: ["fullscreen"] },
      })
    ).toThrow(/must include "inline"/);

    expect(() =>
      bootstrapView({
        default: Probe as ComponentType,
        viewConfig: {
          displayModes: ["inline", "bogus" as "fullscreen"],
        },
      })
    ).toThrow(/invalid mode "bogus"/);
  });

  it("registers view tools via useViewTool with list and call round-trip", async () => {
    resetRuntime();

    let callCount = 0;
    const { bridge, init } = await startHost();

    function View() {
      const [selected, setSelected] = useState<string | null>(null);
      useViewTool(
        {
          name: "pick-item",
          inputSchema: z.object({ id: z.string() }),
          enabled: true,
        },
        async ({ id }) => {
          callCount += 1;
          setSelected(id);
          return {
            content: [{ type: "text", text: id }],
          };
        }
      );
      return <div data-testid="selected">{selected ?? ""}</div>;
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await bridge.sendToolInput({ arguments: {} });
    await bridge.sendToolResult({
      content: [],
      structuredContent: {},
    });

    await waitFor(async () => {
      const result = await bridge.callTool({
        name: "pick-item",
        arguments: { id: "x" },
      });
      expect(result.content?.[0]?.type).toBe("text");
    });

    await waitFor(() => {
      expect(screen.getByTestId("selected").textContent).toBe("x");
      expect(callCount).toBe(1);
    });
  });

  it("useViewTool with inline schema does not re-register per render and toggles enabled in place", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    let listChangedCount = 0;
    bridge.fallbackNotificationHandler = async (notification) => {
      if (notification.method === "notifications/tools/list_changed") {
        listChangedCount += 1;
      }
    };

    function View() {
      const [count, setCount] = useState(0);
      const [enabled, setEnabled] = useState(true);
      // Inline z.object literal: fresh identity every render.
      useViewTool(
        { name: "pick-item", schema: z.object({ id: z.string() }), enabled },
        async ({ id }) => ({
          content: [{ type: "text", text: `${id}:${count}` }],
        })
      );
      return (
        <div>
          <span data-testid="count">{count}</span>
          <button type="button" onClick={() => setCount((n) => n + 1)}>
            rerender
          </button>
          <button type="button" onClick={() => setEnabled(false)}>
            disable
          </button>
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    // Registration itself emits exactly one list_changed.
    await waitFor(async () => {
      const result = await bridge.callTool({
        name: "pick-item",
        arguments: { id: "a" },
      });
      expect(result.content?.[0]).toMatchObject({ text: "a:0" });
    });
    expect(listChangedCount).toBe(1);

    screen.getByText("rerender").click();
    screen.getByText("rerender").click();
    await waitFor(() => {
      expect(screen.getByTestId("count").textContent).toBe("2");
    });

    // Handler sees latest state without re-registration; no list_changed churn.
    const result = await bridge.callTool({
      name: "pick-item",
      arguments: { id: "b" },
    });
    expect(result.content?.[0]).toMatchObject({ text: "b:2" });
    expect(listChangedCount).toBe(1);

    screen.getByText("disable").click();
    await waitFor(() => {
      expect(listChangedCount).toBe(2);
    });
    await expect(
      bridge.callTool({ name: "pick-item", arguments: { id: "c" } })
    ).rejects.toThrow();
  });

  it("sends no model-context update for views that never use ModelContext", async () => {
    resetRuntime();
    const { init, modelContextUpdates } = await startHost();

    function View() {
      return <div data-testid="plain">plain</div>;
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(() => {
      expect(screen.getByTestId("plain")).not.toBeNull();
    });
    // Allow any (erroneous) post-connect flush to drain before asserting.
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(modelContextUpdates).toHaveLength(0);
  });

  it("pushes ModelContext content and clears after removal", async () => {
    resetRuntime();
    const { init, modelContextUpdates } = await startHost();

    function View() {
      const [on, setOn] = useState(true);
      return (
        <div>
          {on && <ModelContext content="Viewing apples" />}
          <button type="button" onClick={() => setOn(false)}>
            remove
          </button>
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(() => {
      expect(modelContextUpdates).toHaveLength(1);
    });
    expect(modelContextUpdates[0]?.content).toEqual([
      { type: "text", text: "- Viewing apples" },
    ]);

    screen.getByText("remove").click();
    await waitFor(() => {
      expect(modelContextUpdates).toHaveLength(2);
    });
    expect(modelContextUpdates[1]?.content).toEqual([]);
  });

  it("serializes nested ModelContext trees and batches sync updates", async () => {
    resetRuntime();
    const { init, modelContextUpdates } = await startHost();

    function View() {
      return (
        <ModelContext content="Dashboard">
          <ModelContext content="Revenue" />
          <ModelContext content="Costs" />
        </ModelContext>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(() => {
      expect(modelContextUpdates).toHaveLength(1);
    });
    expect(modelContextUpdates[0]?.content?.[0]?.text).toBe(
      ["- Dashboard", "  - Revenue", "  - Costs"].join("\n")
    );

    // Multiple sync imperative updates in one turn → one additional push.
    modelContext.set("a", "Alpha");
    modelContext.set("b", "Beta");
    await waitFor(() => {
      expect(modelContextUpdates).toHaveLength(2);
    });
    expect(modelContextUpdates[1]?.content?.[0]?.text).toContain("- Alpha");
    expect(modelContextUpdates[1]?.content?.[0]?.text).toContain("- Beta");
  });

  it("dedupes identical consecutive ModelContext pushes", async () => {
    resetRuntime();
    const { init, modelContextUpdates } = await startHost();

    function View() {
      return <div data-testid="host">host</div>;
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(() => {
      expect(screen.getByTestId("host")).not.toBeNull();
    });

    modelContext.set("k", "Same");
    await waitFor(() => {
      expect(modelContextUpdates).toHaveLength(1);
    });
    expect(modelContextUpdates[0]?.content).toEqual([
      { type: "text", text: "- Same" },
    ]);

    // Identical re-set must not deliver another push.
    modelContext.set("k", "Same");
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(modelContextUpdates).toHaveLength(1);
  });

  it("serializes ModelContext siblings in document order, not useId sort order", async () => {
    resetRuntime();
    const { init, modelContextUpdates } = await startHost();

    // Enough siblings that useId values reach two digits (":r10:" would sort
    // before ":r2:" lexicographically).
    const labels = Array.from({ length: 12 }, (_, i) => `node-${i + 1}`);

    function View() {
      return (
        <div>
          {labels.map((label) => (
            <ModelContext key={label} content={label} />
          ))}
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(() => {
      expect(modelContextUpdates).toHaveLength(1);
    });
    expect(modelContextUpdates[0]?.content?.[0]?.text).toBe(
      labels.map((label) => `- ${label}`).join("\n")
    );
  });

  it("skips model-context updates when the host lacks the updateModelContext capability", async () => {
    resetRuntime();
    const { init, modelContextUpdates } = await startHost(undefined, {
      openLinks: {},
      serverTools: {},
      logging: {},
    });

    function View() {
      return <ModelContext content="Viewing apples" />;
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    // Allow the flush to drain; the capability gate must swallow it.
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(modelContextUpdates).toHaveLength(0);
  });

  it("supports imperative modelContext set, remove, and clear", async () => {
    resetRuntime();
    const { init, modelContextUpdates } = await startHost();

    function View() {
      return <div data-testid="host">host</div>;
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(() => {
      expect(screen.getByTestId("host")).not.toBeNull();
    });

    modelContext.set("active", "Viewing cart");
    await waitFor(() => {
      expect(modelContextUpdates).toHaveLength(1);
    });
    expect(modelContextUpdates[0]?.content).toEqual([
      { type: "text", text: "- Viewing cart" },
    ]);

    modelContext.set("active", "Viewing checkout");
    await waitFor(() => {
      expect(modelContextUpdates).toHaveLength(2);
    });
    expect(modelContextUpdates[1]?.content).toEqual([
      { type: "text", text: "- Viewing checkout" },
    ]);

    modelContext.remove("active");
    await waitFor(() => {
      expect(modelContextUpdates).toHaveLength(3);
    });
    expect(modelContextUpdates[2]?.content).toEqual([]);

    modelContext.set("a", "A");
    modelContext.set("b", "B");
    await waitFor(() => {
      expect(modelContextUpdates.length).toBeGreaterThanOrEqual(4);
    });
    modelContext.clear();
    await waitFor(() => {
      expect(modelContextUpdates.at(-1)?.content).toEqual([]);
    });
  });

  it("resolves root-relative public assets via Image", async () => {
    resetRuntime();
    globalThis.__mcpUseViewConfig = {
      publicBase: "http://test.example/mcp/_mcp-use/public/",
    };

    function Probe() {
      return (
        <div>
          <Image src="/fruits/apple.png" alt="apple" data-testid="fruit" />
          <Image
            src="https://cdn.example.com/logo.svg"
            alt="logo"
            data-testid="absolute"
          />
        </div>
      );
    }

    const { init } = await startHost();
    bootstrapView({ default: Probe as ComponentType });
    await init;

    await waitFor(() => {
      expect(screen.getByTestId("fruit").getAttribute("src")).toBe(
        "http://test.example/mcp/_mcp-use/public/fruits/apple.png"
      );
    });
    expect(screen.getByTestId("absolute").getAttribute("src")).toBe(
      "https://cdn.example.com/logo.svg"
    );
  });

  it("same-root HMR bootstrap reuses the runtime without reconnecting", async () => {
    resetRuntime();
    const [guestTransport, hostTransport] = createPairedTransports();
    let startCount = 0;
    const originalStart = guestTransport.start.bind(guestTransport);
    guestTransport.start = async () => {
      startCount += 1;
      await originalStart();
    };
    _setTransportForTesting(guestTransport);

    const bridge = new AppBridge(
      null,
      { name: "test-host", version: "1.0.0" },
      { openLinks: {}, serverTools: {} }
    );
    const init = new Promise<void>((resolve) => {
      bridge.oninitialized = () => resolve();
    });
    await bridge.connect(hostTransport);

    function First() {
      return <div data-testid="label">first</div>;
    }
    function Second() {
      return <div data-testid="label">second</div>;
    }

    bootstrapView({ default: First as ComponentType });
    await init;
    await waitFor(() => {
      expect(screen.getByTestId("label").textContent).toBe("first");
    });

    const runtimeAfterFirst = _getRuntimeForTesting();
    expect(runtimeAfterFirst).not.toBeNull();
    expect(startCount).toBe(1);

    bootstrapView({ default: Second as ComponentType });
    await waitFor(() => {
      expect(screen.getByTestId("label").textContent).toBe("second");
    });

    expect(_getRuntimeForTesting()).toBe(runtimeAfterFirst);
    expect(startCount).toBe(1);
  });

  it("changed HMR viewConfig warns and keeps the original config", async () => {
    resetRuntime();
    const { init } = await startHost();

    function Probe() {
      return <div data-testid="probe">ok</div>;
    }

    bootstrapView({
      default: Probe as ComponentType,
      viewConfig: { autoResize: true },
    });
    await init;

    const runtime = _getRuntimeForTesting();
    expect(runtime).not.toBeNull();
    expect(runtime!.config.autoResize).toBe(true);

    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      bootstrapView({
        default: Probe as ComponentType,
        viewConfig: { autoResize: false, displayModes: ["inline"] },
      });
    } finally {
      console.warn = originalWarn;
    }

    expect(
      warnings.some((args) =>
        String(args[0]).includes("viewConfig changed during HMR")
      )
    ).toBe(true);
    expect(_getRuntimeForTesting()).toBe(runtime);
    expect(runtime!.config.autoResize).toBe(true);
    expect(appOptions(_getAppForTesting()!).autoResize).toBe(true);
  });

  it("a second rootId while one is mounted throws", async () => {
    resetRuntime();
    const { init } = await startHost();

    function Probe() {
      return <div data-testid="probe">ok</div>;
    }

    bootstrapView({ default: Probe as ComponentType }, { rootId: "root" });
    await init;

    expect(() =>
      bootstrapView({ default: Probe as ComponentType }, { rootId: "other" })
    ).toThrow(/already mounted on "#root".*second root "#other"/);
  });

  it("disposeView unmounts React, closes the transport, and clears the mount", async () => {
    resetRuntime();
    const [guestTransport, hostTransport] = createPairedTransports();
    let closeCount = 0;
    const originalClose = guestTransport.close.bind(guestTransport);
    guestTransport.close = async () => {
      closeCount += 1;
      await originalClose();
    };
    _setTransportForTesting(guestTransport);

    const bridge = new AppBridge(
      null,
      { name: "test-host", version: "1.0.0" },
      { openLinks: {}, serverTools: {} }
    );
    const init = new Promise<void>((resolve) => {
      bridge.oninitialized = () => resolve();
    });
    await bridge.connect(hostTransport);

    function Probe() {
      return <div data-testid="probe">mounted</div>;
    }

    bootstrapView({ default: Probe as ComponentType });
    await init;
    await waitFor(() => {
      expect(screen.getByTestId("probe").textContent).toBe("mounted");
    });

    expect(_getRuntimeForTesting()).not.toBeNull();

    await disposeView();

    expect(screen.queryByTestId("probe")).toBeNull();
    expect(_getRuntimeForTesting()).toBeNull();
    expect(closeCount).toBeGreaterThanOrEqual(1);

    // Mount record cleared: a second rootId is allowed after disposal.
    const [guest2, host2] = createPairedTransports();
    _setTransportForTesting(guest2);
    const bridge2 = new AppBridge(
      null,
      { name: "test-host", version: "1.0.0" },
      { openLinks: {}, serverTools: {} }
    );
    const init2 = new Promise<void>((resolve) => {
      bridge2.oninitialized = () => resolve();
    });
    await bridge2.connect(host2);
    expect(() =>
      bootstrapView({ default: Probe as ComponentType }, { rootId: "other" })
    ).not.toThrow();
    await init2;
    await disposeView();
  });

  it("rebootstrap after disposeView creates a fresh runtime and reconnects", async () => {
    resetRuntime();
    const [guest1, host1] = createPairedTransports();
    let startCount = 0;
    const wrapStart = (
      transport: (typeof guest1)
    ): typeof guest1 => {
      const originalStart = transport.start.bind(transport);
      transport.start = async () => {
        startCount += 1;
        await originalStart();
      };
      return transport;
    };
    _setTransportForTesting(wrapStart(guest1));

    const bridge1 = new AppBridge(
      null,
      { name: "test-host", version: "1.0.0" },
      { openLinks: {}, serverTools: {} }
    );
    const init1 = new Promise<void>((resolve) => {
      bridge1.oninitialized = () => resolve();
    });
    await bridge1.connect(host1);

    function Probe() {
      return <div data-testid="probe">ok</div>;
    }

    bootstrapView({ default: Probe as ComponentType });
    await init1;
    const firstRuntime = _getRuntimeForTesting();
    expect(firstRuntime).not.toBeNull();
    expect(startCount).toBe(1);

    await disposeView();
    expect(_getRuntimeForTesting()).toBeNull();

    const [guest2, host2] = createPairedTransports();
    _setTransportForTesting(wrapStart(guest2));
    const bridge2 = new AppBridge(
      null,
      { name: "test-host", version: "1.0.0" },
      { openLinks: {}, serverTools: {} }
    );
    const init2 = new Promise<void>((resolve) => {
      bridge2.oninitialized = () => resolve();
    });
    await bridge2.connect(host2);

    bootstrapView({ default: Probe as ComponentType });
    await init2;

    const secondRuntime = _getRuntimeForTesting();
    expect(secondRuntime).not.toBeNull();
    expect(secondRuntime).not.toBe(firstRuntime);
    expect(startCount).toBe(2);
  });

  it("disposeView unmounts React before closing the App (view tools remove first)", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      useViewTool(
        {
          name: "ephemeral",
          inputSchema: z.object({}),
        },
        async () => ({
          content: [{ type: "text", text: "ok" }],
        })
      );
      return <div data-testid="view">ok</div>;
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(async () => {
      const listed = await bridge.listTools({});
      expect(listed.tools.map((tool) => tool.name)).toContain("ephemeral");
    });

    const runtime = _getRuntimeForTesting();
    expect(runtime).not.toBeNull();

    const sequence: string[] = [];
    let toolsWhenDisposeEntered: string[] | undefined;
    const originalDispose = runtime!.dispose.bind(runtime);
    runtime!.dispose = async () => {
      sequence.push("runtime.dispose");
      // React unmount (and useViewTool cleanup) must already have run —
      // disposeView calls root.unmount() before runtime.dispose().
      expect(screen.queryByTestId("view")).toBeNull();
      toolsWhenDisposeEntered = (await bridge.listTools({})).tools.map(
        (tool) => tool.name
      );
      await originalDispose();
      sequence.push("runtime.dispose.done");
    };

    await disposeView();

    expect(sequence).toEqual(["runtime.dispose", "runtime.dispose.done"]);
    expect(toolsWhenDisposeEntered).toEqual([]);
    expect(_getRuntimeForTesting()).toBeNull();
  });
});
