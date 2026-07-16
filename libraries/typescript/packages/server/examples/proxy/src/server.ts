import { MCPServer } from "mcp-use";

import { createInventoryServer, createWeatherServer } from "./upstreams.js";

/** Running servers and cleanup returned by {@link createProxyExample}. */
export interface ProxyExample {
  /** Gateway that exposes local and proxied capabilities. */
  server: MCPServer;
  /** Close the gateway and both upstream servers. Safe to call more than once. */
  close(): Promise<void>;
}

/**
 * Start two ephemeral upstream servers and mount them on one proxy gateway.
 * The caller chooses when and where the returned gateway starts listening.
 */
export async function createProxyExample(): Promise<ProxyExample> {
  const weather = createWeatherServer();
  const inventory = createInventoryServer();
  let gateway: MCPServer | undefined;

  try {
    const [weatherAddress, inventoryAddress] = await Promise.all([
      weather.listen(0),
      inventory.listen(0),
    ]);

    gateway = new MCPServer({
      name: "multi-server-proxy",
      version: "1.0.0",
    });

    gateway.tool(
      {
        name: "gateway_status",
        description: "Report whether the proxy gateway is running.",
      },
      async () => ({
        content: [{ type: "text", text: "Proxy gateway is running" }],
      })
    );

    await gateway.proxy({
      weather: {
        url: weatherAddress.url,
        oauth: false,
      },
      inventory: {
        url: inventoryAddress.url,
        oauth: false,
      },
    });
  } catch (error) {
    await Promise.allSettled([
      gateway?.close(),
      weather.close(),
      inventory.close(),
    ]);
    throw error;
  }

  let closed = false;
  return {
    server: gateway,
    async close() {
      if (closed) return;
      closed = true;
      const results = await Promise.allSettled([
        gateway.close(),
        weather.close(),
        inventory.close(),
      ]);
      const errors = results.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : []
      );
      if (errors.length > 0) {
        throw new AggregateError(
          errors,
          "Failed to close proxy example servers"
        );
      }
    },
  };
}
