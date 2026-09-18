import { createTanStackStartHandler } from "mcp-use/tanstack-start";

// Share initialization between the MCP and OAuth discovery routes.
export const handler = createTanStackStartHandler();
