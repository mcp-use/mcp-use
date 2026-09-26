import { describe, expect, it, vi } from "vitest";
import {
  discoverInfrastructure,
  type DiscoveryClient,
} from "../../examples/node/chainlove-discovery.js";

function toolResult(structuredContent: unknown) {
  return {
    isError: false,
    structuredContent,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(structuredContent),
      },
    ],
  };
}

function textResult(value: unknown) {
  return {
    isError: false,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value),
      },
    ],
  };
}

function errorResult() {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: "tool failed",
      },
    ],
  };
}

function createClient(results: Record<string, unknown>): {
  client: DiscoveryClient;
  calls: Array<{
    name: string;
    args: Record<string, unknown>;
    options: { timeout: number };
  }>;
  close: ReturnType<typeof vi.fn>;
} {
  const calls: Array<{
    name: string;
    args: Record<string, unknown>;
    options: { timeout: number };
  }> = [];
  const close = vi.fn(async () => undefined);

  const callTool = vi.fn(
    async (
      name: string,
      args: Record<string, unknown>,
      options: { timeout: number }
    ) => {
      calls.push({ name, args, options });

      const result = results[name];
      if (result instanceof Error) {
        throw result;
      }

      return result;
    }
  );

  return {
    client: {
      connect: vi.fn(async () => ({ callTool })),
      close,
    },
    calls,
    close,
  };
}

describe("discoverInfrastructure", () => {
  it("discovers services with bounded search results and closes the client", async () => {
    const { client, calls, close } = createClient({
      discover_networks: toolResult({
        networks: [{ chain: "filecoin" }],
      }),
      discover_categories: toolResult({
        exists: true,
        categories: [{ name: "apis" }],
      }),
      search: toolResult({
        results: [
          {
            service_id: "service-1",
            provider: "Provider One",
            title: "API One",
          },
        ],
        total: 1,
      }),
    });

    const result = await discoverInfrastructure(client);

    expect(result).toEqual({
      results: [
        {
          service_id: "service-1",
          provider: "Provider One",
          title: "API One",
        },
      ],
      total: 1,
    });

    expect(calls).toEqual([
      {
        name: "discover_networks",
        args: {},
        options: { timeout: 30_000 },
      },
      {
        name: "discover_categories",
        args: { chain: "filecoin" },
        options: { timeout: 30_000 },
      },
      {
        name: "search",
        args: { chain: "filecoin", category: "apis", limit: 3 },
        options: { timeout: 30_000 },
      },
    ]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("accepts JSON returned as text content", async () => {
    const { client } = createClient({
      discover_networks: textResult({
        networks: [{ chain: "filecoin" }],
      }),
      discover_categories: textResult({
        exists: true,
        categories: [{ name: "apis" }],
      }),
      search: textResult({
        results: [],
        total: 0,
      }),
    });

    await expect(discoverInfrastructure(client)).resolves.toEqual({
      results: [],
      total: 0,
    });
  });

  it("stops before search when the category is unavailable", async () => {
    const { client, calls, close } = createClient({
      discover_networks: toolResult({
        networks: [{ chain: "filecoin" }],
      }),
      discover_categories: toolResult({
        exists: true,
        categories: [{ name: "storages" }],
      }),
      search: toolResult({
        results: [],
        total: 0,
      }),
    });

    await expect(discoverInfrastructure(client)).rejects.toThrow(
      'Unknown category "apis" for filecoin'
    );

    expect(calls).toHaveLength(2);
    expect(close).toHaveBeenCalledOnce();
  });

  it("stops dependent discovery when the network is unknown", async () => {
    const { client, calls, close } = createClient({
      discover_networks: toolResult({
        networks: [{ chain: "ethereum" }],
      }),
      discover_categories: toolResult({
        exists: true,
        categories: [{ name: "apis" }],
      }),
      search: toolResult({
        results: [],
        total: 0,
      }),
    });

    await expect(discoverInfrastructure(client)).rejects.toThrow(
      'Unknown network "filecoin"'
    );

    expect(calls).toHaveLength(1);
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects unsuccessful tool responses and closes the client", async () => {
    const { client, close } = createClient({
      discover_networks: errorResult(),
    });

    await expect(discoverInfrastructure(client)).rejects.toThrow(
      "discover_networks returned a tool error"
    );

    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects malformed structured responses and closes the client", async () => {
    const { client, close } = createClient({
      discover_networks: toolResult({
        networks: [{ invalid: "shape" }],
      }),
    });

    await expect(discoverInfrastructure(client)).rejects.toThrow();
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the client after a transport failure", async () => {
    const { client, close } = createClient({
      discover_networks: new Error("network unavailable"),
    });

    await expect(discoverInfrastructure(client)).rejects.toThrow(
      "network unavailable"
    );

    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the client when connection establishment fails", async () => {
    const close = vi.fn(async () => undefined);
    const client: DiscoveryClient = {
      connect: vi.fn(async () => {
        throw new Error("connection failed");
      }),
      close,
    };

    await expect(discoverInfrastructure(client)).rejects.toThrow(
      "connection failed"
    );

    expect(close).toHaveBeenCalledOnce();
  });
});
