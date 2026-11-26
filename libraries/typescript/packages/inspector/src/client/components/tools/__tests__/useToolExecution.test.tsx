// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureInspectorEvent } from "@/client/telemetry";
import { saveStoredConnectionConfig } from "@/client/utils/connectionUpdates";
import { useToolExecution } from "../useToolExecution";

vi.mock("@/client/telemetry", () => ({
  MCPToolExecutionEvent: class {
    constructor(readonly payload: unknown) {}
  },
  captureInspectorEvent: vi.fn(async () => {}),
}));

describe("useToolExecution", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it.each([
    {
      name: "legacy flat metadata",
      toolMeta: { "ui/resourceUri": "ui://weather/forecast.html" },
    },
    {
      name: "nested metadata",
      toolMeta: { ui: { resourceUri: "ui://weather/forecast.html" } },
    },
    {
      name: "nested metadata taking precedence over the flat key",
      toolMeta: {
        ui: { resourceUri: "ui://weather/forecast.html" },
        "ui/resourceUri": "ui://wrong/legacy.html",
      },
    },
  ])(
    "prefetches and updates the pending view with $name",
    async ({ toolMeta }) => {
      let finishTool!: (result: unknown) => void;
      const pendingTool = new Promise<unknown>((resolve) => {
        finishTool = resolve;
      });
      const callTool = vi.fn(() => pendingTool);
      const readResource = vi.fn(async () => ({ contents: [] }));
      let latest!: ReturnType<typeof useToolExecution>;
      let execution!: Promise<void>;

      function TestComponent() {
        latest = useToolExecution({
          selectedTool: {
            name: "weather",
            inputSchema: { type: "object" },
            _meta: toolMeta,
          },
          payloadToSend: { city: "Tokyo" },
          toolArgs: { city: "Tokyo" },
          callTool,
          readResource,
          serverId: "weather-server",
          isConnected: true,
        });
        return null;
      }

      const root = createRoot(document.createElement("div"));
      try {
        await act(async () => root.render(<TestComponent />));
        await act(async () => {
          execution = latest.executeTool();
        });

        expect(readResource).toHaveBeenCalledWith("ui://weather/forecast.html");
        expect(callTool).toHaveBeenCalledWith(
          "weather",
          { city: "Tokyo" },
          expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
        expect(latest.isExecuting).toBe(true);
        expect(latest.results).toEqual([
          expect.objectContaining({
            toolName: "weather",
            args: { city: "Tokyo" },
            result: null,
            toolMeta,
          }),
        ]);

        await act(async () => {
          finishTool({ content: [{ type: "text", text: "Sunny" }] });
          await execution;
        });

        expect(latest.isExecuting).toBe(false);
        expect(latest.results).toEqual([
          expect.objectContaining({
            toolName: "weather",
            result: { content: [{ type: "text", text: "Sunny" }] },
            toolMeta,
          }),
        ]);
      } finally {
        finishTool({});
        await act(async () => {
          await execution;
          root.unmount();
        });
      }
    }
  );

  it("uses the saved connection timeouts for tool calls", async () => {
    saveStoredConnectionConfig("server-1", {
      url: "http://localhost:3000/mcp",
      transportType: "http",
      requestTimeout: 50,
      maxTotalTimeout: 200,
      resetTimeoutOnProgress: false,
    });
    const callTool = vi.fn(async () => ({}));

    function TestComponent() {
      const execution = useToolExecution({
        selectedTool: { name: "slow_tool", inputSchema: { type: "object" } },
        payloadToSend: {},
        toolArgs: {},
        callTool,
        readResource: vi.fn(async () => ({})),
        serverId: "server-1",
        isConnected: true,
      });
      useEffect(() => {
        void execution.executeTool();
      }, []);
      return null;
    }

    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(<TestComponent />);
      await Promise.resolve();
    });

    expect(callTool).toHaveBeenCalledWith(
      "slow_tool",
      {},
      expect.objectContaining({
        timeout: 50,
        maxTotalTimeout: 200,
        resetTimeoutOnProgress: false,
      })
    );
    await act(async () => root.unmount());
  });

  it("does not report a user-cancelled run as a tool failure", async () => {
    const callTool = vi.fn(
      async (
        _name: string,
        _args: Record<string, unknown>,
        options?: { signal?: AbortSignal }
      ) =>
        new Promise<never>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Cancelled", "AbortError"));
          });
        })
    );
    let latest: ReturnType<typeof useToolExecution> | undefined;
    let execution: Promise<void> | undefined;

    function TestComponent() {
      latest = useToolExecution({
        selectedTool: {
          name: "slow_tool",
          inputSchema: { type: "object" },
        },
        payloadToSend: {},
        toolArgs: {},
        callTool,
        readResource: vi.fn(async () => ({})),
        serverId: "server-1",
        isConnected: true,
      });
      useEffect(() => {
        execution = latest?.executeTool();
      }, []);
      return null;
    }

    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(<TestComponent />);
      await Promise.resolve();
    });
    expect(callTool).toHaveBeenCalledOnce();

    await act(async () => {
      latest!.cancelExecution();
      await execution;
    });

    expect(latest?.results).toEqual([]);
    expect(captureInspectorEvent).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });
});
