/**
 * Integrate an MCP server and its compiled views with Next.js App Router.
 *
 * @packageDocumentation
 */

export { createNextHandler } from "./handler.js";
export type { NextMcpHandlers } from "./handler.js";
export { withMcpUse } from "./config.js";
export type { NextConfigLike, WithMcpUseOptions } from "./config.js";
