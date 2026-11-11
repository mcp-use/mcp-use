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

describe("useToolExecution cancellation", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    localStorage.clear();
  });

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
