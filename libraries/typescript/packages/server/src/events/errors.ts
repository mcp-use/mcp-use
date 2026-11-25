/**
 * MCP Events error classes and codes (PLAN.md §7.4). `EventsError` (the
 * app-throwable wire error) is the one definition in `@mcp-use/events-core`.
 *
 * @packageDocumentation
 */

export { EventsError } from "@mcp-use/events-core";
export type { EventsErrorKind } from "@mcp-use/events-core";

export * from "./config-error.js";
