import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpClientProvider } from "../../../src/react/McpClientProvider.js";
import { MemoryStorageProvider } from "../../../src/react/storage.js";
import type {
  McpServerConfig,
  UseMcpOptions,
} from "../../../src/react/types.js";

const seenOptions = new Map<string, UseMcpOptions>();
vi.mock("../../../src/react/useMcp.js", () => {
  const result = {
    state: "ready",
    tools: [],
    resources: [],
    resourceTemplates: [],
    prompts: [],
    log: [],
    disconnect: vi.fn(),
    clearStorage: vi.fn(),
  };
  return {
    useMcp: (options: UseMcpOptions) => {
      seenOptions.set(options.url, options);
      return result;
    },
  };
});

const callbackUrl = "https://app.example.com/oauth/callback";
const metadataUrl = "https://app.example.com/oauth/client-metadata.json";
let renderer: ReactTestRenderer | undefined;

describe("McpClientProvider CIMD default", () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    seenOptions.clear();
  });

  it.each(["initial", "restored"] as const)(
    "applies to %s connections without overriding OAuth settings",
    async (source) => {
      const configs: Record<string, McpServerConfig> = {
        plain: { url: "https://plain.example/mcp" },
        scoped: { url: "https://scoped.example/mcp", oauth: { scope: "read" } },
        static: {
          url: "https://static.example/mcp",
          oauth: { clientId: "registered-client", scope: "write" },
        },
        custom: {
          url: "https://custom.example/mcp",
          oauth: { clientMetadataUrl: "https://custom.example/client.json" },
        },
        disabled: {
          url: "https://disabled.example/mcp",
          oauth: { clientMetadataUrl: "" },
        },
        callback: {
          url: "https://callback.example/mcp",
          callbackUrl: "https://another.example/oauth/callback",
        },
      };
      const storage = new MemoryStorageProvider();
      if (source === "restored") {
        for (const [id, config] of Object.entries(configs))
          storage.setServer(id, config);
      }
      await act(async () => {
        renderer = create(
          React.createElement(McpClientProvider, {
            children: null,
            defaultCallbackUrl: callbackUrl,
            defaultOAuthClientMetadataUrl: metadataUrl,
            ...(source === "initial"
              ? { mcpServers: configs }
              : { storageProvider: storage }),
          })
        );
      });
      expect(seenOptions.get(configs.plain.url)?.oauth).toEqual({
        clientMetadataUrl: metadataUrl,
      });
      expect(seenOptions.get(configs.scoped.url)?.oauth).toEqual({
        clientMetadataUrl: metadataUrl,
        scope: "read",
      });
      for (const id of ["static", "custom", "disabled", "callback"]) {
        expect(seenOptions.get(configs[id].url)?.oauth).toEqual(
          configs[id].oauth
        );
      }
      if (source === "restored") {
        expect(storage.getServers().plain.oauth).toBeUndefined();
        expect(storage.getServers().scoped.oauth).toEqual({ scope: "read" });
      }
    }
  );
});
