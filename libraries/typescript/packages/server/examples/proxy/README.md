# Multiple-server proxy example

This example starts two upstream MCP servers and exposes both through one gateway. The gateway adds `weather_` and `inventory_` namespaces while preserving a local `gateway_status` tool.

## Run the gateway

From `libraries/typescript`:

```bash
pnpm install
pnpm --filter mcp-use-example-proxy start
```

The gateway listens at `http://localhost:3000/mcp`. Set `PORT` to use another port.

The process starts and stops both upstream servers automatically. The upstream servers use ephemeral local ports, so the example does not require separate terminals or port configuration.

## Inspect the exposed capabilities

Connect an MCP client to `http://localhost:3000/mcp`. The gateway exposes:

| Capability | Name | Source |
| --- | --- | --- |
| Tool | `gateway_status` | Gateway |
| Tool | `weather_forecast` | Weather server |
| Prompt | `weather_plan_trip` | Weather server |
| Tool | `inventory_find_product` | Inventory server |
| Resource | `inventory_featured_product` | Inventory server |

This package lists `@mcp-use/client` as a dependency because it calls `server.proxy()`. Projects that do not use `server.proxy()` do not need to install the optional client peer.
