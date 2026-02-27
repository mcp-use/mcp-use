import { MCPServer } from "mcp-use/server";

const server = new MCPServer({
  name: "ProxyAggregator",
  version: "1.0.0",
});

async function main() {
  console.log("Setting up proxy connections...");

  // Path to the fastmcp test server
  const fastMcpServerPath = "/tmp/fastmcp/test_server.py";

  console.log("Calling server.proxy()...");

  // Mount the servers
  await server.proxy({
    conformance: {
      url: "http://localhost:4000/mcp",
    },
    fastmcp: {
      command: "/tmp/fastmcp/.venv/bin/python",
      args: [fastMcpServerPath],
      env: {
        ...process.env,
        FASTMCP_LOG_LEVEL: "ERROR",
      },
    },
    manufact: {
      url: "https://manufact.com/docs/mcp",
    },
  });

  console.log(
    "Servers proxied successfully under namespaces 'conformance', 'fastmcp', and 'manufact'."
  );

  // Expose our own tool as well
  server.tool(
    {
      name: "aggregator_info",
      description: "Get info about the aggregator",
    },
    async () => {
      return {
        content: [
          {
            type: "text",
            text: "This is the aggregator server. It proxies three remote/local servers.",
          },
        ],
      };
    }
  );

  // Since it's a standard server, we can serve it over HTTP.
  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  await server.listen(port);
  console.log(`Aggregator listening on http://localhost:${port}/mcp`);
}

main().catch(console.error);
