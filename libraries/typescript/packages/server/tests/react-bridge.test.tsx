// @vitest-environment happy-dom
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { useState, type ComponentType } from "react";

import {
  bootstrapView,
  Image,
  useCallTool,
  useDisplayMode,
  useHostContext,
  useOpenExternal,
  useSendFollowUp,
  useViewContext,
  useViewTool,
} from "../src/react/index.js";
import { _resetModelContextForTesting } from "../src/react/bridge/model-context-store.js";
import { _resetBootstrapRootsForTesting } from "../src/react/bridge/bootstrap-view.js";
import {
  _resetViewBridgeForTesting,
  _setTransportForTesting,
} from "../src/react/bridge/view-bridge.js";
import { createPairedTransports } from "./helpers/paired-transport.js";

function resetRuntime(): void {
  _resetViewBridgeForTesting();
  _resetModelContextForTesting();
  _resetBootstrapRootsForTesting();
  document.body.innerHTML = "";
}

async function startHost(
  onCallTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>
) {
  const [guestTransport, hostTransport] = createPairedTransports();
  _setTransportForTesting(guestTransport);

  const bridge = new AppBridge(
    null,
    { name: "test-host", version: "1.0.0" },
    { openLinks: {}, serverTools: {}, logging: {} }
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

  bridge.onupdatemodelcontext = async () => ({});

  const init = new Promise<void>((resolve) => {
    bridge.oninitialized = () => {
      resolve();
    };
  });

  await bridge.connect(hostTransport);
  return { bridge, init };
}

describe("react bridge runtime", () => {
  it("mounts the default export immediately and transitions useViewContext pending → streaming → ready", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function View() {
      const handle = useViewContext();
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
          {(handle.partialToolInput as { query?: string } | undefined)?.query ??
            ""}
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

  it("surfaces meta on useViewContext and useCallTool round-trips with state transitions", async () => {
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
      const context = useViewContext();
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

    expect(screen.getByTestId("mode").textContent).toBe("inline");

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

    screen.getByText("follow-up").click();
    await waitFor(() => {
      expect(followUpPrompt).toBe("refine");
    });

    screen.getByText("open").click();
    await waitFor(() => {
      expect(openedUrl).toBe("https://example.com");
    });
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
          schema: z.object({ id: z.string() }),
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

    expect(screen.getByTestId("fruit").getAttribute("src")).toBe(
      "http://test.example/mcp/_mcp-use/public/fruits/apple.png"
    );
    expect(screen.getByTestId("absolute").getAttribute("src")).toBe(
      "https://cdn.example.com/logo.svg"
    );
  });
});
