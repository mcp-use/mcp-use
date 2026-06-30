import React, { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import {
  McpClientProvider,
  useMcpClient,
} from "../../../src/react/McpClientProvider.js";

vi.mock("../../../src/react/useMcp.js", () => {
  const tools: unknown[] = [];
  const resources: unknown[] = [];
  const resourceTemplates: unknown[] = [];
  const prompts: unknown[] = [];
  const serverInfo = { name: "sandbox", version: "1.0.0" };
  const capabilities = {};
  const client = { id: "mock-client" };
  const log: unknown[] = [];

  return {
    useMcp: () => {
      const [state, setState] = React.useState<
        "discovering" | "pending_auth" | "authenticating" | "ready" | "failed"
      >("discovering");

      useEffect(() => {
        setState("ready");
      }, []);

      return {
        name: "sandbox",
        tools,
        resources,
        resourceTemplates,
        prompts,
        serverInfo,
        capabilities,
        state,
        error: undefined,
        authUrl: undefined,
        authTokens: undefined,
        log,
        callTool: vi.fn(),
        refresh: vi.fn(),
        reconnect: vi.fn(),
        disconnect: vi.fn(),
        clearStorage: vi.fn(),
        client,
      };
    },
  };
});

function AddSandboxServerOnMount() {
  const { addServer, storageLoaded } = useMcpClient();

  useEffect(() => {
    if (!storageLoaded) return;

    addServer("sandbox", {
      url: "http://localhost:3000/mcp",
      name: "Sandbox MCP Server",
    });
  }, [addServer, storageLoaded]);

  return null;
}

describe("McpClientProvider render warning reproduction", () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not trigger render-phase update warning when callbacks mutate server state", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await act(async () => {
      create(
        React.createElement(
          McpClientProvider,
          {
            onServerAdded: (_id, server) => {
              // This setter lives in McpServerWrapper; calling it synchronously
              // from McpClientProvider's setState updater reproduces the warning.
              server.clearNotifications();
            },
          },
          React.createElement(AddSandboxServerOnMount)
        )
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const combinedConsoleErrors = consoleError.mock.calls
      .flatMap((args) => args.map((arg) => String(arg)))
      .join("\n");

    expect(combinedConsoleErrors).not.toContain("Cannot update a component");
  });
});
