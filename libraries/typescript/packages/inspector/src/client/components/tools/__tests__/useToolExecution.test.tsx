// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useToolExecution } from "../useToolExecution";

vi.mock("@/client/telemetry", () => ({
  MCPToolExecutionEvent: class {
    constructor(_properties: unknown) {}
  },
  captureInspectorEvent: vi.fn().mockResolvedValue(undefined),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("useToolExecution", () => {
  const roots: ReturnType<typeof createRoot>[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      act(() => root.unmount());
    }
    sessionStorage.clear();
  });

  it("does not let a cancelled request clear a newer execution", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const callTool = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    let latest: ReturnType<typeof useToolExecution> | undefined;

    function TestComponent(): ReactNode {
      latest = useToolExecution({
        selectedTool: {
          name: "protected_profile",
          inputSchema: { type: "object" },
        },
        payloadToSend: {},
        toolArgs: {},
        callTool,
        readResource: vi.fn(),
        serverId: "http://localhost:3001/mcp",
        isConnected: true,
      });
      return null;
    }

    const root = createRoot(document.createElement("div"));
    roots.push(root);
    await act(async () => root.render(<TestComponent />));

    let firstExecution!: Promise<void>;
    await act(async () => {
      firstExecution = latest!.executeTool();
      await Promise.resolve();
    });
    expect(latest?.isExecuting).toBe(true);

    act(() => latest!.cancelExecution());
    expect(latest?.isExecuting).toBe(false);

    let secondExecution!: Promise<void>;
    await act(async () => {
      secondExecution = latest!.executeTool();
      await Promise.resolve();
    });
    expect(latest?.isExecuting).toBe(true);

    await act(async () => {
      first.reject(new DOMException("Aborted", "AbortError"));
      await firstExecution;
    });
    expect(latest?.isExecuting).toBe(true);

    await act(async () => {
      second.resolve({ content: [{ type: "text", text: "ok" }] });
      await secondExecution;
    });
    expect(latest?.isExecuting).toBe(false);
  });
});
