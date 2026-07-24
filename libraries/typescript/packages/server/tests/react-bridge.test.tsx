// @vitest-environment happy-dom
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { useState, type ComponentType, type SetStateAction } from "react";

import {
  bootstrapView,
  disposeView,
  Image,
  ModelContext,
  modelContext,
  ToolError,
  ThemeProvider,
  toolResultText,
  useCallTool,
  useDynamicTool,
  useDisplayMode,
  useHostContext,
  useOpenExternal,
  useSendFollowUp,
  useSendSizeChanged,
  useToolContext,
  useViewState,
  useViewTheme,
  useViewTool,
  useWidget,
  ViewControls,
} from "../src/react/index.js";
import { _resetBootstrapRootsForTesting } from "../src/react/runtime/bootstrap-view.js";
import { _resetModelContextForTesting } from "../src/react/components/model-context.js";
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
      _appCapabilities: { availableDisplayModes?: readonly string[] };
    }
  )._appCapabilities;
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
    message: { text: {} },
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
    structuredContent?: Record<string, unknown>;
  }[] = [];
  bridge.onupdatemodelcontext = async (params) => {
    modelContextUpdates.push(
      params as {
        content?: { type: string; text?: string }[];
        structuredContent?: Record<string, unknown>;
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

function expectModelContextUpdate(
  update:
    | {
        content?: { type: string; text?: string }[];
        structuredContent?: Record<string, unknown>;
      }
    | undefined,
  expected: Record<string, unknown>
): void {
  expect(update?.structuredContent).toEqual(expected);
  expect(update?.content).toEqual([
    { type: "text", text: JSON.stringify(expected) },
  ]);
}

describe("react bridge runtime", () => {
  it("mounts immediately, exposes progressive pending input, then latches ready", async () => {
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
            <span data-testid="meta">
              {handle.meta ? JSON.stringify(handle.meta) : ""}
            </span>
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
      expect(screen.getByTestId("lifecycle").textContent).toBe("pending-ap");
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

  it("replaces toolInput across partial and complete notifications while pending", async () => {
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
      expect(screen.getByTestId("lifecycle").textContent).toBe("pending|a");
    });
    expect(_getRuntimeForTesting()?.getToolSnapshot().isToolInputPartial).toBe(
      true
    );

    await bridge.sendToolInputPartial({ arguments: { query: "ap" } });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("pending|ap");
    });

    await bridge.sendToolInput({ arguments: { query: "apple" } });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("pending|apple");
    });
    expect(_getRuntimeForTesting()?.getToolSnapshot().isToolInputPartial).toBe(
      false
    );

    await bridge.sendToolResult({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { query: "apple", items: ["a"] },
    });

    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("ready|apple");
    });
  });

  it("preserves legacy streaming and unconstrained-height semantics", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      const widget = useWidget();
      const partial = widget.partialToolInput as { query?: string } | null;
      return (
        <div data-testid="legacy-widget">
          {String(widget.isStreaming)}|{partial?.query ?? ""}|{widget.maxHeight}
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;
    await waitFor(() => {
      expect(screen.getByTestId("legacy-widget").textContent).toBe(
        "false||600"
      );
    });

    await bridge.sendToolInputPartial({ arguments: { query: "ap" } });
    await waitFor(() => {
      expect(screen.getByTestId("legacy-widget").textContent).toBe(
        "true|ap|600"
      );
    });

    await bridge.sendToolInput({ arguments: { query: "apple" } });
    await waitFor(() => {
      expect(screen.getByTestId("legacy-widget").textContent).toBe(
        "false||600"
      );
    });
  });

  it("serializes back-to-back legacy functional state updates", async () => {
    resetRuntime();
    const { init, modelContextUpdates } = await startHost();

    function View() {
      const widget = useWidget<Record<string, never>, { count: number }>();
      return (
        <button
          data-testid="legacy-state"
          type="button"
          onClick={() => {
            void Promise.all([
              widget.setState((previous) => ({
                count: (previous?.count ?? 0) + 1,
              })),
              widget.setState((previous) => ({
                count: (previous?.count ?? 0) + 1,
              })),
            ]);
          }}
        >
          {widget.state?.count ?? 0}
        </button>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;
    await waitFor(() => {
      expect(screen.getByTestId("legacy-state").textContent).toBe("0");
    });
    await act(async () => {
      screen.getByTestId("legacy-state").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("legacy-state").textContent).toBe("2");
      expect(modelContextUpdates).toHaveLength(2);
    });
    expect(
      modelContextUpdates.map((update) => update.structuredContent)
    ).toEqual([{ count: 1 }, { count: 2 }]);
  });

  it("leaves the progressive pending snapshot unchanged on cancellation", async () => {
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

    await bridge.sendToolInputPartial({ arguments: { query: "ap" } });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("pending|ap");
    });

    await bridge.sendToolCancelled({ reason: "user action" });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("pending|ap");
    });
  });

  it("surfaces valid tool errors as status error with ToolError", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      const handle = useToolContext();
      if (handle.status === "error") {
        return (
          <div data-testid="lifecycle">
            error|
            {handle.error instanceof ToolError ? "tool" : "other"}|
            {handle.error.message}|
            {handle.toolOutput === undefined ? "no-out" : "has-out"}|
            {handle.content?.[0] && "type" in handle.content[0]
              ? handle.content[0].type
              : ""}
          </div>
        );
      }
      return <div data-testid="lifecycle">{handle.status}</div>;
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await bridge.sendToolInput({ arguments: { query: "x" } });
    await bridge.sendToolResult({
      content: [{ type: "text", text: "failed" }],
      isError: true,
    });

    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe(
        "error|tool|failed|no-out|text"
      );
    });
  });

  it("derives tool error message from multiple text blocks joined with newlines", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      const handle = useToolContext();
      if (handle.status === "error") {
        return <div data-testid="msg">{handle.error.message}</div>;
      }
      return <div data-testid="msg">{handle.status}</div>;
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await bridge.sendToolResult({
      content: [
        { type: "text", text: "line one" },
        { type: "text", text: "line two" },
      ],
      isError: true,
    });

    await waitFor(() => {
      expect(screen.getByTestId("msg").textContent).toBe("line one\nline two");
    });
  });

  it("falls back to a generic tool error message when there are no text blocks", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      const handle = useToolContext();
      if (handle.status === "error") {
        return <div data-testid="msg">{handle.error.message}</div>;
      }
      return <div data-testid="msg">{handle.status}</div>;
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await bridge.sendToolResult({
      content: [],
      isError: true,
    });

    await waitFor(() => {
      expect(screen.getByTestId("msg").textContent).toBe(
        "Tool returned an error."
      );
    });
  });

  it("toolResultText joins text blocks and returns undefined when empty", () => {
    expect(
      toolResultText({
        content: [
          { type: "text", text: "a" },
          { type: "image", data: "x", mimeType: "image/png" },
          { type: "text", text: "b" },
        ],
      })
    ).toBe("a\nb");
    expect(toolResultText({ content: [] })).toBeUndefined();
    expect(
      toolResultText({
        content: [{ type: "text", text: "   " }],
      })
    ).toBeUndefined();
    expect(
      toolResultText({
        content: [{ type: "image", data: "x", mimeType: "image/png" }],
      })
    ).toBeUndefined();
  });

  it("ignores content-only successes while pending and can later latch structured output", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      function View() {
        const handle = useToolContext();
        return (
          <div data-testid="lifecycle">
            {handle.status}|
            {handle.status === "ready" ? JSON.stringify(handle.toolOutput) : ""}
          </div>
        );
      }

      bootstrapView({ default: View as ComponentType });
      await init;

      await bridge.sendToolInput({ arguments: {} });
      await bridge.sendToolResult({
        content: [{ type: "text", text: "no structured" }],
      });

      await waitFor(() => {
        expect(screen.getByTestId("lifecycle").textContent).toBe("pending|");
      });
      expect(
        errorSpy.mock.calls.some((args) =>
          String(args[0]).includes("non-error result without structuredContent")
        )
      ).toBe(false);

      await bridge.sendToolResult({
        content: [{ type: "text", text: "ready" }],
        structuredContent: { ok: true },
      });
      await waitFor(() => {
        expect(screen.getByTestId("lifecycle").textContent).toBe(
          'ready|{"ok":true}'
        );
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("latches a tool error and ignores subsequent input", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      const handle = useToolContext();
      return <div data-testid="lifecycle">{handle.status}</div>;
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await bridge.sendToolResult({
      content: [{ type: "text", text: "failed" }],
      isError: true,
    });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("error");
    });

    await bridge.sendToolInput({ arguments: { query: "retry" } });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("error");
    });
  });

  it("continues accepting progressive input after cancellation until a result latches", async () => {
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
      expect(screen.getByTestId("lifecycle").textContent).toBe("pending|ap");
    });

    await bridge.sendToolCancelled({ reason: "user action" });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("pending|ap");
    });

    await bridge.sendToolInputPartial({ arguments: { query: "or" } });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("pending|or");
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

  it("keeps the first ready result latched across all later lifecycle notifications", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      const handle = useToolContext();
      if (handle.status === "ready") {
        const { query } = handle.toolOutput as { query: string };
        return <div data-testid="lifecycle">ready|{query}</div>;
      }
      return <div data-testid="lifecycle">{handle.status}</div>;
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

    // These notifications can belong to useCallTool/useViewTool executions.
    // None may overwrite the invocation that rendered the View.
    await bridge.sendToolInput({ arguments: { query: "banana" } });
    await bridge.sendToolCancelled({ reason: "retry aborted" });
    await bridge.sendToolInputPartial({ arguments: { query: "ch" } });
    await bridge.sendToolResult({
      content: [{ type: "text", text: "content only" }],
    });
    await bridge.sendToolResult({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { query: "cherry", items: ["c"] },
    });
    await bridge.sendToolResult({
      content: [{ type: "text", text: "late failure" }],
      isError: true,
    });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("ready|apple");
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
      expect(screen.getByTestId("lifecycle").textContent).toBe("pending");
    });
    await bridge.sendToolInputPartial({ arguments: { query: "ap" } });
    await waitFor(() => {
      expect(screen.getByTestId("lifecycle").textContent).toBe("pending");
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
      openExternal?: (args: { url: string }) => Promise<void>;
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
          {theme}|{displayMode}|{String(refs.openExternal === openExternal)}|
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
      if (args.id === "tool-error") {
        return {
          content: [{ type: "text", text: "tool error" }],
          isError: true,
        };
      }
      if (args.id === "bare") {
        return {
          content: [{ type: "text", text: "bare content" }],
        };
      }
      return {
        content: [{ type: "text", text: name }],
        structuredContent: { value: String(args.id ?? "") },
      };
    });

    function Probe() {
      const context = useToolContext();
      const tool = useDynamicTool<{ id: string }, { value: string }>("lookup");
      return (
        <div>
          <span data-testid="meta">
            {context.status === "ready" && context.meta
              ? JSON.stringify(context.meta)
              : ""}
          </span>
          <span data-testid="pending">{String(tool.isPending)}</span>
          <span data-testid="error">{tool.error?.message ?? ""}</span>
          <span data-testid="error-name">{tool.error?.name ?? ""}</span>
          <span data-testid="data">
            {tool.data
              ? tool.data.structuredContent !== undefined
                ? JSON.stringify(tool.data.structuredContent)
                : `content:${tool.data.content?.[0] && "text" in tool.data.content[0] ? String(tool.data.content[0].text) : ""}`
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
          <button
            type="button"
            onClick={() => {
              void tool.callTool({ id: "tool-error" }).catch(() => undefined);
            }}
          >
            tool-error
          </button>
          <button
            type="button"
            onClick={() => {
              void tool.callTool({ id: "bare" });
            }}
          >
            bare
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
    // Transport failure preserves previous successful data.
    expect(screen.getByTestId("data").textContent).toBe('{"value":"42"}');

    screen.getByText("tool-error").click();
    await waitFor(() => {
      expect(screen.getByTestId("error-name").textContent).toBe("ToolError");
      expect(screen.getByTestId("error").textContent).toBe("tool error");
      expect(screen.getByTestId("pending").textContent).toBe("false");
    });
    // Tool error rejects and preserves previous successful data.
    expect(screen.getByTestId("data").textContent).toBe('{"value":"42"}');

    screen.getByText("call").click();
    await waitFor(() => {
      expect(screen.getByTestId("data").textContent).toBe('{"value":"42"}');
    });

    // A bare content-only success (schema-less tool) resolves into data.
    screen.getByText("bare").click();
    await waitFor(() => {
      expect(screen.getByTestId("data").textContent).toBe(
        "content:bare content"
      );
      expect(screen.getByTestId("error").textContent).toBe("");
      expect(screen.getByTestId("pending").textContent).toBe("false");
    });

    screen.getByText("call").click();
    await waitFor(() => {
      expect(screen.getByTestId("data").textContent).toBe('{"value":"42"}');
      expect(screen.getByTestId("error").textContent).toBe("");
    });

    // A compliant host also forwards lifecycle notifications for the later
    // useCallTool execution. The rendering invocation is already latched.
    await bridge.sendToolInput({ arguments: { id: "bare" } });
    await bridge.sendToolResult({
      content: [{ type: "text", text: "bare content" }],
    });
    await bridge.sendToolResult({
      content: [{ type: "text", text: "unrelated structured result" }],
      structuredContent: { value: "ambient" },
      _meta: { secret: false },
    });
    expect(screen.getByTestId("meta").textContent).toContain("secret");
    expect(screen.getByTestId("meta").textContent).toContain("true");
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
      const { displayMode, availableDisplayModes, requestDisplayMode } =
        useDisplayMode();
      return (
        <div>
          <span data-testid="mode">{displayMode}</span>
          <span data-testid="available">{availableDisplayModes.join(",")}</span>
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
      // Host omitted availableDisplayModes → only inline until host reports.
      expect(screen.getByTestId("available").textContent).toBe("inline");
    });

    await bridge.sendHostContextChange({
      availableDisplayModes: ["inline", "fullscreen"],
    });
    await waitFor(() => {
      expect(screen.getByTestId("available").textContent).toBe(
        "inline,fullscreen"
      );
    });

    screen.getByText("expand").click();
    await waitFor(() => {
      expect(requestedMode).toBe("fullscreen");
    });
  });

  it("ThemeProvider fills the guest document in fullscreen and restores inline", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      return (
        <ThemeProvider>
          <div data-testid="content">view content</div>
        </ThemeProvider>
      );
    }

    act(() => {
      bootstrapView({ default: View as ComponentType });
    });
    await init;

    const root = document.getElementById("root");
    expect(root).not.toBeNull();
    expect(root!.style.height).toBe("");

    await act(async () => {
      await bridge.sendHostContextChange({ displayMode: "fullscreen" });
    });
    await waitFor(() => {
      expect(document.documentElement.style.height).toBe("100%");
      expect(document.body.style.height).toBe("100%");
      expect(root!.style.height).toBe("100%");
    });

    await act(async () => {
      await bridge.sendHostContextChange({ displayMode: "inline" });
    });
    await waitFor(() => {
      expect(document.documentElement.style.height).toBe("");
      expect(document.body.style.height).toBe("");
      expect(root!.style.height).toBe("");
    });
  });

  it("ViewControls stays inline until Debug expands it, then restores the prior mode", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();
    const requestedModes: string[] = [];
    bridge.onrequestdisplaymode = async ({ mode }) => {
      requestedModes.push(mode);
      return { mode };
    };

    function View() {
      return (
        <ViewControls debugger>
          <div>view content</div>
        </ViewControls>
      );
    }

    act(() => {
      bootstrapView({ default: View as ComponentType });
    });
    await init;
    await act(async () => {
      await bridge.sendHostContextChange({
        availableDisplayModes: ["inline", "fullscreen"],
      });
    });
    expect(requestedModes).toEqual([]);

    await act(async () => {
      screen.getByRole("button", { name: "Debug" }).click();
    });
    await waitFor(() => {
      expect(requestedModes).toEqual(["fullscreen"]);
      expect(
        screen.getByRole("button", { name: "Close debug" })
      ).not.toBeNull();
      expect(screen.getByRole("dialog", { name: "Debug info" })).not.toBeNull();
    });

    await act(async () => {
      screen.getByRole("button", { name: "Close debug" }).click();
    });
    await waitFor(() => {
      expect(requestedModes).toEqual(["fullscreen", "inline"]);
      expect(screen.queryByRole("dialog", { name: "Debug info" })).toBeNull();
    });
  });

  it("useSendFollowUp and useOpenExternal invoke bridge actions", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    let followUpPrompt: string | undefined;
    let openedUrl: string | undefined;
    let openExternalRef: ((args: { url: string }) => Promise<void>) | undefined;

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
      openExternalRef = openExternal;
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
              void openExternal({ url: "https://example.com" });
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
      expect(openExternalRef).toBeTypeOf("function");
    });

    // useOpenExternal returns a Promise-returning callback.
    const openPromise = openExternalRef!({ url: "https://probe.example" });
    expect(openPromise).toBeInstanceOf(Promise);
    await openPromise;
    expect(openedUrl).toBe("https://probe.example");
    openedUrl = undefined;

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

  it("lists and calls multiple view tools registered by useViewTool", async () => {
    resetRuntime();

    let callCount = 0;
    const { bridge, init } = await startHost();

    function View() {
      const initialContext = useToolContext();
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
      useViewTool(
        {
          name: "echo-item",
          inputSchema: z.object({ id: z.string() }),
        },
        async ({ id }) => ({
          content: [{ type: "text", text: `echo:${id}` }],
        })
      );
      return (
        <div>
          <div data-testid="selected">{selected ?? ""}</div>
          <div data-testid="initial-context">
            {initialContext.status === "ready"
              ? JSON.stringify(initialContext.toolOutput)
              : initialContext.status}
          </div>
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await bridge.sendToolInput({ arguments: {} });
    await bridge.sendToolResult({
      content: [],
      structuredContent: { source: "rendering-invocation" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("initial-context").textContent).toBe(
        '{"source":"rendering-invocation"}'
      );
    });

    await waitFor(async () => {
      expect(
        (await bridge.listTools({})).tools.map((tool) => tool.name)
      ).toEqual(["pick-item", "echo-item"]);
    });

    const pickResult = await bridge.callTool({
      name: "pick-item",
      arguments: { id: "x" },
    });
    expect(pickResult.content?.[0]).toMatchObject({ text: "x" });
    const echoResult = await bridge.callTool({
      name: "echo-item",
      arguments: { id: "y" },
    });
    expect(echoResult.content?.[0]).toMatchObject({ text: "echo:y" });

    await waitFor(() => {
      expect(screen.getByTestId("selected").textContent).toBe("x");
      expect(callCount).toBe(1);
    });

    await expect(
      bridge.callTool({ name: "pick-item", arguments: { id: 123 } })
    ).rejects.toThrow();
    expect(callCount).toBe(1);

    // Mirror the host lifecycle notification for the content-only View-tool
    // response. It is valid ambient activity and cannot replace the latched
    // initial context.
    await bridge.sendToolInput({ arguments: { id: "x" } });
    await bridge.sendToolResult(pickResult);
    expect(screen.getByTestId("initial-context").textContent).toBe(
      '{"source":"rendering-invocation"}'
    );
  });

  it("useViewTool passes parsed schema input and normalizes schema-less input to an empty object", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    let parsedArgs: unknown;
    let schemaLessArgs: unknown;
    let schemaCalls = 0;
    let schemaLessCalls = 0;

    function View() {
      useViewTool(
        {
          name: "parsed-command",
          inputSchema: z.object({
            value: z.string().transform((value) => value.toUpperCase()),
          }),
        },
        async (args) => {
          schemaCalls += 1;
          parsedArgs = args;
          return { content: [{ type: "text", text: args.value }] };
        }
      );
      useViewTool({ name: "reset-command" }, async (args) => {
        schemaLessCalls += 1;
        schemaLessArgs = args;
        return { content: [{ type: "text", text: "reset" }] };
      });
      return <div data-testid="registered">ready</div>;
    }

    bootstrapView({ default: View as ComponentType });
    await init;
    await waitFor(() => {
      expect(screen.getByTestId("registered").textContent).toBe("ready");
    });
    await waitFor(async () => {
      const names = (await bridge.listTools({})).tools.map((tool) => tool.name);
      expect(names).toHaveLength(2);
      expect(names).toEqual(
        expect.arrayContaining(["parsed-command", "reset-command"])
      );
    });

    const parsedResult = await bridge.callTool({
      name: "parsed-command",
      arguments: { value: "hello" },
    });
    expect(parsedResult.content?.[0]).toMatchObject({ text: "HELLO" });
    expect(parsedArgs).toEqual({ value: "HELLO" });
    expect(schemaCalls).toBe(1);

    await expect(
      bridge.callTool({
        name: "parsed-command",
        arguments: { value: 42 },
      })
    ).rejects.toThrow();
    expect(schemaCalls).toBe(1);

    const resetResult = await bridge.callTool({
      name: "reset-command",
      arguments: { shouldBeIgnored: true },
    });
    expect(resetResult.content?.[0]).toMatchObject({ text: "reset" });
    expect(schemaLessArgs).toEqual({});
    expect(schemaLessCalls).toBe(1);
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
    await expect(
      bridge.callTool({ name: "pick-item", arguments: { id: 1 } })
    ).rejects.toThrow();
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

  it("useViewTool registers during connection and removes on pre-connect unmount", async () => {
    resetRuntime();
    const [guestTransport, hostTransport] = createPairedTransports();
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const originalSend = guestTransport.send.bind(guestTransport);
    guestTransport.send = async (message) => {
      await gate;
      return originalSend(message);
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

    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    try {
      function ToolChild() {
        useViewTool(
          {
            name: "late-tool",
            inputSchema: z.object({}),
          },
          async () => ({
            content: [{ type: "text", text: "ok" }],
          })
        );
        return <div data-testid="tool-child">mounted</div>;
      }

      function Parent() {
        const [show, setShow] = useState(true);
        return (
          <div>
            {show ? <ToolChild /> : <div data-testid="gone">gone</div>}
            <button type="button" onClick={() => setShow(false)}>
              unmount-tool
            </button>
          </div>
        );
      }

      bootstrapView({ default: Parent as ComponentType });
      await waitFor(() => {
        expect(screen.getByTestId("tool-child")).not.toBeNull();
      });

      const app = _getAppForTesting();
      expect(app).not.toBeNull();
      const listLocally = app!.onlisttools as unknown as () => Promise<{
        tools: { name: string }[];
      }>;
      await waitFor(async () => {
        expect((await listLocally()).tools.map((tool) => tool.name)).toEqual([
          "late-tool",
        ]);
      });

      screen.getByText("unmount-tool").click();
      await waitFor(() => {
        expect(screen.getByTestId("gone")).not.toBeNull();
      });

      releaseGate();
      await init;
      // Allow connection completion and the host-side list to settle.
      await new Promise((resolve) => setTimeout(resolve, 30));

      const listed = await bridge.listTools({});
      expect(listed.tools.map((tool) => tool.name)).not.toContain("late-tool");
      expect(
        errors.filter((args) =>
          String(args[0]).includes("useViewTool failed to register")
        )
      ).toHaveLength(0);
    } finally {
      console.error = originalError;
    }
  });

  it("useViewTool remains registered when the one connection attempt fails", async () => {
    resetRuntime();
    const connectError = new Error("inject-view-connect-fail");
    _setTransportForTesting({
      async start() {},
      async send() {
        throw connectError;
      },
      async close() {},
    } as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      function View() {
        useViewTool(
          {
            name: "available-after-failure",
            inputSchema: z.object({ value: z.string() }),
          },
          async ({ value }) => ({
            content: [{ type: "text", text: value }],
          })
        );
        return <div data-testid="failed-view">mounted</div>;
      }

      bootstrapView({ default: View as ComponentType });
      await waitFor(() => {
        expect(screen.getByTestId("failed-view")).not.toBeNull();
      });

      const runtime = _getRuntimeForTesting();
      const app = _getAppForTesting();
      expect(runtime).not.toBeNull();
      expect(app).not.toBeNull();
      await expect(runtime!.connect()).rejects.toThrow(
        /inject-view-connect-fail|already connected|invalid/i
      );
      expect(runtime!.getHostSnapshot()).toMatchObject({
        isConnected: false,
        connectionError: expect.any(Error),
      });

      const listLocally = app!.onlisttools as unknown as () => Promise<{
        tools: { name: string }[];
      }>;
      await expect(listLocally()).resolves.toMatchObject({
        tools: [{ name: "available-after-failure" }],
      });
      const callLocally = app!.oncalltool as unknown as (params: {
        name: string;
        arguments: Record<string, unknown>;
      }) => Promise<{ content?: { type: string; text?: string }[] }>;
      await expect(
        callLocally({
          name: "available-after-failure",
          arguments: { value: "still here" },
        })
      ).resolves.toMatchObject({ content: [{ text: "still here" }] });
      expect(
        errorSpy.mock.calls.some((args) =>
          String(args[0]).includes("useViewTool failed to register")
        )
      ).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("useViewTool removes the registration when unmounted after connect", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function ToolChild() {
      useViewTool(
        {
          name: "ephemeral",
          inputSchema: z.object({}),
        },
        async () => ({
          content: [{ type: "text", text: "ok" }],
        })
      );
      return <div data-testid="tool-child">mounted</div>;
    }

    function Parent() {
      const [show, setShow] = useState(true);
      return (
        <div>
          {show ? <ToolChild /> : <div data-testid="gone">gone</div>}
          <button type="button" onClick={() => setShow(false)}>
            unmount-tool
          </button>
        </div>
      );
    }

    bootstrapView({ default: Parent as ComponentType });
    await init;

    await waitFor(async () => {
      const listed = await bridge.listTools({});
      expect(listed.tools.map((tool) => tool.name)).toContain("ephemeral");
    });

    screen.getByText("unmount-tool").click();
    await waitFor(() => {
      expect(screen.getByTestId("gone")).not.toBeNull();
    });

    await waitFor(async () => {
      const listed = await bridge.listTools({});
      expect(listed.tools.map((tool) => tool.name)).not.toContain("ephemeral");
    });
  });

  it("useViewTool metadata update clears title and description with explicit undefined", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      const [rich, setRich] = useState(true);
      useViewTool(
        rich
          ? {
              name: "meta-tool",
              title: "Rich Title",
              description: "Rich description",
              inputSchema: z.object({}),
            }
          : {
              name: "meta-tool",
              inputSchema: z.object({}),
            },
        async () => ({
          content: [{ type: "text", text: "ok" }],
        })
      );
      return (
        <button type="button" onClick={() => setRich(false)}>
          clear-meta
        </button>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(async () => {
      const listed = await bridge.listTools({});
      const tool = listed.tools.find((entry) => entry.name === "meta-tool");
      expect(tool?.title).toBe("Rich Title");
      expect(tool?.description).toBe("Rich description");
    });

    screen.getByText("clear-meta").click();

    await waitFor(async () => {
      const listed = await bridge.listTools({});
      const tool = listed.tools.find((entry) => entry.name === "meta-tool");
      expect(tool).toBeDefined();
      expect(tool?.title).toBeUndefined();
      expect(tool?.description).toBeUndefined();
    });
  });

  it("useViewTool rapid name change removes the old tool and keeps the new one", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      const [name, setName] = useState("tool-a");
      useViewTool(
        {
          name,
          inputSchema: z.object({}),
        },
        async () => ({
          content: [{ type: "text", text: name }],
        })
      );
      return (
        <div>
          <span data-testid="name">{name}</span>
          <button type="button" onClick={() => setName("tool-b")}>
            rename
          </button>
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(async () => {
      const listed = await bridge.listTools({});
      expect(listed.tools.map((tool) => tool.name)).toEqual(["tool-a"]);
    });

    screen.getByText("rename").click();
    await waitFor(() => {
      expect(screen.getByTestId("name").textContent).toBe("tool-b");
    });

    await waitFor(async () => {
      const listed = await bridge.listTools({});
      expect(listed.tools.map((tool) => tool.name)).toEqual(["tool-b"]);
    });

    // Stale cleanup must not have removed the new registration.
    const result = await bridge.callTool({
      name: "tool-b",
      arguments: {},
    });
    expect(result.content?.[0]).toMatchObject({ text: "tool-b" });
  });

  it("useViewTool reports registration failure without throwing or breaking the app", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      function View() {
        useViewTool(
          {
            name: "shared-name",
            inputSchema: z.object({}),
          },
          async () => ({
            content: [{ type: "text", text: "first" }],
          })
        );
        useViewTool(
          {
            name: "shared-name",
            inputSchema: z.object({}),
          },
          async () => ({
            content: [{ type: "text", text: "second" }],
          })
        );
        return <div data-testid="alive">alive</div>;
      }

      bootstrapView({ default: View as ComponentType });
      await init;

      await waitFor(() => {
        expect(screen.getByTestId("alive").textContent).toBe("alive");
      });

      await waitFor(() => {
        expect(
          errorSpy.mock.calls.some((args) =>
            String(args[0]).includes(
              'useViewTool failed to register tool "shared-name"'
            )
          )
        ).toBe(true);
      });

      await waitFor(async () => {
        const listed = await bridge.listTools({});
        expect(listed.tools.map((tool) => tool.name)).toEqual(["shared-name"]);
      });

      const result = await bridge.callTool({
        name: "shared-name",
        arguments: {},
      });
      expect(result.content?.[0]).toMatchObject({ text: "first" });
    } finally {
      errorSpy.mockRestore();
    }
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

  it("initializes useViewState, shares it across components, and sends complete MCP model context", async () => {
    resetRuntime();
    const { init, modelContextUpdates } = await startHost();
    let lazyInitializations = 0;

    function Counter() {
      const [state, setState] = useViewState({ count: 0 });
      return (
        <button
          type="button"
          onClick={() =>
            setState((previous) => ({ count: previous.count + 1 }))
          }
        >
          child:{state.count}
        </button>
      );
    }

    function View() {
      const [state] = useViewState(() => {
        lazyInitializations += 1;
        return { count: 0 };
      });
      return (
        <div>
          <span data-testid="parent-count">parent:{state.count}</span>
          <Counter />
        </div>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(() => {
      expect(modelContextUpdates).toHaveLength(1);
    });
    expect(lazyInitializations).toBe(1);
    expectModelContextUpdate(modelContextUpdates[0], {
      count: 0,
      _uiContext: "",
    });

    await act(async () => {
      screen.getByText("child:0").click();
    });
    await waitFor(() => {
      expect(screen.getByTestId("parent-count").textContent).toBe("parent:1");
      expect(screen.getByText("child:1")).not.toBeNull();
      expect(modelContextUpdates).toHaveLength(2);
    });
    expectModelContextUpdate(modelContextUpdates[1], {
      count: 1,
      _uiContext: "",
    });
  });

  it("rejects reserved and non-serializable useViewState values", async () => {
    resetRuntime();
    const { init } = await startHost();
    type CountState = { count: number };
    let setViewState: ((state: SetStateAction<CountState>) => void) | undefined;

    function View() {
      const [, setState] = useViewState<CountState>({ count: 0 });
      setViewState = setState;
      return <div data-testid="state-host" />;
    }

    bootstrapView({ default: View as ComponentType });
    await init;
    await waitFor(() => {
      expect(screen.getByTestId("state-host")).not.toBeNull();
    });

    expect(setViewState).toBeDefined();
    if (setViewState === undefined) throw new Error("setter was not captured");
    const capturedSetViewState = setViewState;
    expect(() =>
      capturedSetViewState({
        count: 0,
        _uiContext: "reserved",
      } as unknown as CountState)
    ).toThrow('reserved key "_uiContext"');
    expect(() =>
      capturedSetViewState({ count: BigInt(1) } as unknown as CountState)
    ).toThrow("must be JSON-serializable");
  });

  it("restores and subscribes to ChatGPT widget state without using MCP model context", async () => {
    resetRuntime();
    const widgetApi: {
      widgetState: {
        modelContent: Record<string, unknown>;
        privateContent: Record<string, unknown>;
        imageIds: string[];
      };
      setWidgetState: ReturnType<typeof vi.fn>;
    } = {
      widgetState: {
        modelContent: { count: 4, _uiContext: "stale" },
        privateContent: { secret: true },
        imageIds: ["image-1"],
      },
      setWidgetState: vi.fn(async (nextState) => {
        widgetApi.widgetState = nextState;
      }),
    };
    Object.defineProperty(window, "openai", {
      configurable: true,
      writable: true,
      value: widgetApi,
    });

    try {
      const { init, modelContextUpdates } = await startHost();

      function View() {
        const [state, setState] = useViewState({ count: 0 });
        return (
          <ModelContext content="Dashboard">
            <button
              type="button"
              onClick={() =>
                setState((previous) => ({ count: previous.count + 1 }))
              }
            >
              count:{state.count}
            </button>
          </ModelContext>
        );
      }

      bootstrapView({ default: View as ComponentType });
      await init;

      await waitFor(() => {
        expect(screen.getByText("count:4")).not.toBeNull();
        expect(widgetApi.setWidgetState).toHaveBeenCalledTimes(1);
      });
      expect(widgetApi.setWidgetState).toHaveBeenLastCalledWith({
        privateContent: { secret: true },
        imageIds: ["image-1"],
        modelContent: { count: 4, _uiContext: "- Dashboard" },
      });

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("openai:set_globals", {
            detail: {
              globals: {
                widgetState: {
                  ...widgetApi.widgetState,
                  modelContent: { count: 8, _uiContext: "host context" },
                },
              },
            },
          })
        );
      });
      await waitFor(() => {
        expect(screen.getByText("count:8")).not.toBeNull();
        expect(widgetApi.setWidgetState).toHaveBeenCalledTimes(2);
      });
      expect(widgetApi.widgetState.modelContent).toEqual({
        count: 8,
        _uiContext: "- Dashboard",
      });

      await act(async () => {
        screen.getByText("count:8").click();
      });
      await waitFor(() => {
        expect(screen.getByText("count:9")).not.toBeNull();
        expect(widgetApi.setWidgetState).toHaveBeenCalledTimes(3);
      });
      expect(widgetApi.widgetState.modelContent).toEqual({
        count: 9,
        _uiContext: "- Dashboard",
      });
      expect(modelContextUpdates).toHaveLength(0);
    } finally {
      resetRuntime();
      delete (window as unknown as { openai?: unknown }).openai;
    }
  });

  it("falls back to MCP model context when window.openai has no setWidgetState", async () => {
    resetRuntime();
    Object.defineProperty(window, "openai", {
      configurable: true,
      writable: true,
      value: { widgetState: { modelContent: { count: 99 } } },
    });

    try {
      const { init, modelContextUpdates } = await startHost();

      function View() {
        const [state] = useViewState({ count: 1 });
        return <div data-testid="fallback-count">{state.count}</div>;
      }

      bootstrapView({ default: View as ComponentType });
      await init;

      await waitFor(() => {
        expect(screen.getByTestId("fallback-count").textContent).toBe("1");
        expect(modelContextUpdates).toHaveLength(1);
      });
      expectModelContextUpdate(modelContextUpdates[0], {
        count: 1,
        _uiContext: "",
      });
    } finally {
      resetRuntime();
      delete (window as unknown as { openai?: unknown }).openai;
    }
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
    expectModelContextUpdate(modelContextUpdates[0], {
      _uiContext: "- Viewing apples",
    });

    screen.getByText("remove").click();
    await waitFor(() => {
      expect(modelContextUpdates).toHaveLength(2);
    });
    expectModelContextUpdate(modelContextUpdates[1], { _uiContext: "" });
  });

  it("serializes nested ModelContext trees and batches sync updates", async () => {
    resetRuntime();
    const { init, modelContextUpdates } = await startHost();

    function View() {
      useViewState({ count: 1 });
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
    expectModelContextUpdate(modelContextUpdates[0], {
      count: 1,
      _uiContext: ["- Dashboard", "  - Revenue", "  - Costs"].join("\n"),
    });

    // Multiple sync imperative updates in one turn → one additional push.
    modelContext.set("a", "Alpha");
    modelContext.set("b", "Beta");
    await waitFor(() => {
      expect(modelContextUpdates).toHaveLength(2);
    });
    expect(modelContextUpdates[1]?.structuredContent?._uiContext).toContain(
      "- Alpha"
    );
    expect(modelContextUpdates[1]?.structuredContent?._uiContext).toContain(
      "- Beta"
    );
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
    expect(modelContextUpdates[0]?.structuredContent).toEqual({
      _uiContext: "- Same",
    });

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
    expect(modelContextUpdates[0]?.structuredContent).toEqual({
      _uiContext: labels.map((label) => `- ${label}`).join("\n"),
    });
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
    expect(modelContextUpdates[0]?.structuredContent).toEqual({
      _uiContext: "- Viewing cart",
    });

    modelContext.set("active", "Viewing checkout");
    await waitFor(() => {
      expect(modelContextUpdates).toHaveLength(2);
    });
    expect(modelContextUpdates[1]?.structuredContent).toEqual({
      _uiContext: "- Viewing checkout",
    });

    modelContext.remove("active");
    await waitFor(() => {
      expect(modelContextUpdates).toHaveLength(3);
    });
    expect(modelContextUpdates[2]?.structuredContent).toEqual({
      _uiContext: "",
    });

    modelContext.set("a", "A");
    modelContext.set("b", "B");
    await waitFor(() => {
      expect(modelContextUpdates.length).toBeGreaterThanOrEqual(4);
    });
    modelContext.clear();
    await waitFor(() => {
      expect(modelContextUpdates.at(-1)?.structuredContent).toEqual({
        _uiContext: "",
      });
    });
  });

  it("empty ModelContext parent preserves children at the nearest ancestor", async () => {
    resetRuntime();
    const { init, modelContextUpdates } = await startHost();

    function View() {
      return (
        <ModelContext content="">
          <ModelContext content="child" />
        </ModelContext>
      );
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(() => {
      expect(modelContextUpdates).toHaveLength(1);
    });
    expect(modelContextUpdates[0]?.structuredContent).toEqual({
      _uiContext: "- child",
    });
  });

  it("failed model-context send remains dirty and retries on the next mutation", async () => {
    resetRuntime();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { bridge, init, modelContextUpdates } = await startHost();

    let shouldFail = true;
    bridge.onupdatemodelcontext = async (params) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("inject-model-context-fail");
      }
      modelContextUpdates.push(
        params as {
          content?: { type: string; text?: string }[];
        }
      );
      return {};
    };

    function View() {
      return <div data-testid="host">host</div>;
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(() => {
      expect(screen.getByTestId("host")).not.toBeNull();
    });

    modelContext.set("k", "First");
    await waitFor(() => {
      expect(shouldFail).toBe(false);
    });
    expect(modelContextUpdates).toHaveLength(0);

    modelContext.set("k", "Second");
    await waitFor(() => {
      expect(modelContextUpdates).toHaveLength(1);
    });
    expect(modelContextUpdates[0]?.structuredContent).toEqual({
      _uiContext: "- Second",
    });

    warnSpy.mockRestore();
  });

  it("in-flight model-context updates coalesce to the latest payload", async () => {
    resetRuntime();
    const { bridge, init, modelContextUpdates } = await startHost();

    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let callCount = 0;

    bridge.onupdatemodelcontext = async (params) => {
      callCount += 1;
      if (callCount === 1) {
        await firstGate;
      }
      modelContextUpdates.push(
        params as {
          content?: { type: string; text?: string }[];
        }
      );
      return {};
    };

    function View() {
      return <div data-testid="host">host</div>;
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(() => {
      expect(screen.getByTestId("host")).not.toBeNull();
    });

    modelContext.set("k", "A");
    await waitFor(() => {
      expect(callCount).toBe(1);
    });

    modelContext.set("k", "B");
    modelContext.set("k", "C");
    releaseFirst?.();

    await waitFor(() => {
      expect(modelContextUpdates).toHaveLength(2);
    });
    expect(modelContextUpdates[0]?.structuredContent?._uiContext).toBe("- A");
    expect(modelContextUpdates[1]?.structuredContent?._uiContext).toBe("- C");
    expect(callCount).toBe(2);
  });

  it("disposal cancels stale model-context completion", async () => {
    resetRuntime();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { bridge, init, modelContextUpdates } = await startHost();

    let releaseSend: (() => void) | undefined;
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    let hostCalls = 0;

    bridge.onupdatemodelcontext = async (params) => {
      hostCalls += 1;
      await sendGate;
      modelContextUpdates.push(
        params as {
          content?: { type: string; text?: string }[];
        }
      );
      return {};
    };

    function View() {
      return <div data-testid="host">host</div>;
    }

    bootstrapView({ default: View as ComponentType });
    await init;

    await waitFor(() => {
      expect(screen.getByTestId("host")).not.toBeNull();
    });

    modelContext.set("k", "Stale");
    await waitFor(() => {
      expect(hostCalls).toBe(1);
    });

    await disposeView();
    expect(_getRuntimeForTesting()).toBeNull();

    releaseSend?.();
    await new Promise((resolve) => setTimeout(resolve, 25));

    // The in-flight host call may complete, but the disposed store must not
    // acknowledge or schedule another send.
    expect(hostCalls).toBe(1);

    warnSpy.mockRestore();
  });

  it("imperative modelContext throws when no view runtime is mounted", async () => {
    resetRuntime();
    await disposeView();
    expect(_getRuntimeForTesting()).toBeNull();
    expect(() => modelContext.set("k", "x")).toThrow(/bootstrapView/);
    expect(() => modelContext.remove("k")).toThrow(/bootstrapView/);
    expect(() => modelContext.clear()).toThrow(/bootstrapView/);
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
    const appAfterFirst = _getAppForTesting();
    expect(runtimeAfterFirst).not.toBeNull();
    expect(appAfterFirst).not.toBeNull();
    expect(startCount).toBe(1);

    bootstrapView({ default: Second as ComponentType });
    await waitFor(() => {
      expect(screen.getByTestId("label").textContent).toBe("second");
    });

    expect(_getRuntimeForTesting()).toBe(runtimeAfterFirst);
    expect(_getAppForTesting()).toBe(appAfterFirst);
    expect(startCount).toBe(1);
  });

  it("removes the compiling indicator before the app renders", async () => {
    resetRuntime();
    const { init } = await startHost();
    const container = document.createElement("div");
    container.id = "root";
    container.setAttribute("data-mcp-use-loading", "");
    document.body.appendChild(container);
    let loadingAttributeDuringRender: boolean | undefined;

    function Probe() {
      loadingAttributeDuringRender = container.hasAttribute(
        "data-mcp-use-loading"
      );
      return <div data-testid="probe">ready</div>;
    }

    bootstrapView({ default: Probe as ComponentType });

    expect(container.hasAttribute("data-mcp-use-loading")).toBe(false);
    await init;
    await waitFor(() => {
      expect(screen.getByTestId("probe").textContent).toBe("ready");
    });
    expect(loadingAttributeDuringRender).toBe(false);
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

  it("rebootstrap after disposeView creates and connects a fresh runtime", async () => {
    resetRuntime();
    const [guest1, host1] = createPairedTransports();
    let startCount = 0;
    const wrapStart = (transport: typeof guest1): typeof guest1 => {
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
