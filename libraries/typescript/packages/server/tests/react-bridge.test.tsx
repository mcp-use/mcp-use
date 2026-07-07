// @vitest-environment happy-dom
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { useState, type ComponentType } from "react";

import {
  bootstrapView,
  useCallTool,
  useView,
  useViewTool,
} from "../src/react/index.js";
import { _resetModelContextForTesting } from "../src/react/model-context-store.js";
import { _resetBootstrapRootsForTesting } from "../src/react/bootstrap-view.js";
import {
  _resetViewBridgeForTesting,
  _setTransportForTesting,
} from "../src/react/view-bridge.js";
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
  it("renders Loading with progressive partialInput then swaps to the default export", async () => {
    resetRuntime();
    const { bridge, init } = await startHost();

    function Loading({
      partialInput,
      isStreaming,
    }: {
      partialInput?: { query?: string };
      isStreaming: boolean;
    }) {
      return (
        <div data-testid="loading">
          {partialInput?.query}-{String(isStreaming)}
        </div>
      );
    }

    function View({ query, items }: { query: string; items: string[] }) {
      return (
        <div data-testid="view">
          {query}:{items.join(",")}
        </div>
      );
    }

    bootstrapView({
      default: View as ComponentType<Record<string, unknown>>,
      Loading: Loading as ComponentType<{
        partialInput?: unknown;
        isStreaming: boolean;
      }>,
    });
    await init;

    await bridge.sendToolInputPartial({ arguments: { query: "ap" } });
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("ap-true");
    });

    await bridge.sendToolInput({ arguments: { query: "apple" } });
    await bridge.sendToolResult({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { query: "apple", items: ["a", "b"] },
      _meta: { trace: "view-only" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("view").textContent).toBe("apple:a,b");
    });
    expect(screen.queryByTestId("loading")).toBeNull();
  });

  it("surfaces meta on useView and useCallTool round-trips with state transitions", async () => {
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
      const view = useView();
      const tool = useCallTool<{ id: string }, { value: string }>("lookup");
      return (
        <div>
          <span data-testid="meta">{view.meta ? JSON.stringify(view.meta) : ""}</span>
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

    bootstrapView({ default: Probe as ComponentType<Record<string, unknown>> });
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

    bootstrapView({ default: View as ComponentType<Record<string, unknown>> });
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
});
