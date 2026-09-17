import { createTanStackStartHandler } from "mcp-use/tanstack-start";
import server from "./server";

// Share initialization between the MCP and OAuth discovery routes.
export const handler = createTanStackStartHandler(server);
