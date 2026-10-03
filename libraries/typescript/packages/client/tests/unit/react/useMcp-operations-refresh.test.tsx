// @vitest-environment jsdom
import React from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { useMcpOperations } from "../../../src/react/useMcp-operations.js";
import type { UseMcpResult } from "../../../src/react/types.js";
import type { MCPConnection } from "../../../src/core/session.js";

type HarnessOptions = {
  state?: UseMcpResult["state"];
  connection?: Partial<MCPConnection> | null;
  hasClient?: boolean;
  isMounted?: boolean;
};

function renderOperationsHarness(options: HarnessOptions = {}) {
  const stateRef = { current: options.state ?? "ready" };
  const connectionRef = {
    current: (options.connection !== undefined
      ? options.connection
      : {
          listTools: vi.fn().mockResolvedValue([]),
          listAllResources: vi.fn().mockResolvedValue({ resources: [] }),
          listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
          listResourceTemplates: vi
            .fn()
            .mockResolvedValue({ resourceTemplates: [] }),
        }) as MCPConnection | null,
  };
  const setTools = vi.fn();
  const setResources = vi.fn();
  const setResourceTemplates = vi.fn();
  const setPrompts = vi.fn();
  const setSkills = vi.fn();
  const addLog = vi.fn();
  const onAuthorizationRequired = vi.fn();
  const isMounted = vi.fn(() => options.isMounted ?? true);
  const hasClient = vi.fn(() => options.hasClient ?? true);

  let ops!: ReturnType<typeof useMcpOperations>;

  function TestComponent() {
    ops = useMcpOperations({
      stateRef,
      connectionRef,
      hasClient,
      isMounted,
      setTools,
      setResources,
      setResourceTemplates,
      setPrompts,
      setSkills,
      addLog,
      onAuthorizationRequired,
    });
    return null;
  }

  act(() => {
    create(<TestComponent />);
  });

  return {
    ops,
    stateRef,
    connectionRef,
    setResourceTemplates,
    addLog,
    isMounted,
  };
}

describe("useMcpOperations - refreshResourceTemplates and refreshAll", () => {
  it("safely no-ops when disconnected without throwing or rejecting refreshAll", async () => {
    const { ops, setResourceTemplates } = renderOperationsHarness({
      state: "disconnected",
      connection: null,
      hasClient: false,
    });

    await expect(ops.refreshResourceTemplates()).resolves.toBeUndefined();
    await expect(ops.refreshAll()).resolves.toBeUndefined();
    expect(setResourceTemplates).not.toHaveBeenCalled();
  });

  it("safely no-ops when connecting without throwing", async () => {
    const { ops, setResourceTemplates } = renderOperationsHarness({
      state: "connecting",
      connection: null,
      hasClient: true,
    });

    await expect(ops.refreshResourceTemplates()).resolves.toBeUndefined();
    await expect(ops.refreshAll()).resolves.toBeUndefined();
    expect(setResourceTemplates).not.toHaveBeenCalled();
  });

  it("refreshes resource templates successfully when ready", async () => {
    const mockTemplates = [
      { uriTemplate: "file:///{path}", name: "Local Files" },
    ];
    const listResourceTemplates = vi
      .fn()
      .mockResolvedValue({ resourceTemplates: mockTemplates });
    const { ops, setResourceTemplates } = renderOperationsHarness({
      state: "ready",
      connection: {
        listTools: vi.fn().mockResolvedValue([]),
        listAllResources: vi.fn().mockResolvedValue({ resources: [] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        listResourceTemplates,
      },
    });

    await expect(ops.refreshResourceTemplates()).resolves.toBeUndefined();
    expect(listResourceTemplates).toHaveBeenCalledTimes(1);
    expect(setResourceTemplates).toHaveBeenCalledWith(mockTemplates);
  });

  it("catches server errors and logs warning without rejecting refreshResourceTemplates or refreshAll", async () => {
    const serverError = new Error("Method not found: resources/templates/list");
    const listResourceTemplates = vi.fn().mockRejectedValue(serverError);
    const { ops, addLog, setResourceTemplates } = renderOperationsHarness({
      state: "ready",
      connection: {
        listTools: vi.fn().mockResolvedValue([]),
        listAllResources: vi.fn().mockResolvedValue({ resources: [] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        listResourceTemplates,
      },
    });

    await expect(ops.refreshResourceTemplates()).resolves.toBeUndefined();
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Failed to refresh resource templates:",
      serverError
    );
    expect(setResourceTemplates).not.toHaveBeenCalled();

    // refreshAll also succeeds cleanly despite template failure
    await expect(ops.refreshAll()).resolves.toBeUndefined();
  });

  it("does not update state if unmounted before response arrives", async () => {
    const listResourceTemplates = vi.fn().mockResolvedValue({
      resourceTemplates: [{ uriTemplate: "file:///{path}" }],
    });
    const { ops, setResourceTemplates } = renderOperationsHarness({
      state: "ready",
      isMounted: false,
      connection: {
        listTools: vi.fn().mockResolvedValue([]),
        listAllResources: vi.fn().mockResolvedValue({ resources: [] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        listResourceTemplates,
      },
    });

    await ops.refreshResourceTemplates();
    expect(listResourceTemplates).toHaveBeenCalledTimes(1);
    expect(setResourceTemplates).not.toHaveBeenCalled();
  });
});
