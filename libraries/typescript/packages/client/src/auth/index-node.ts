/**
 * Node-only OAuth utilities for MCP. This entry pulls `node:http`,
 * `node:fs`, and `node:os` — do not import from browser code.
 *
 * For browser OAuth, use `mcp-use/auth` instead.
 */

export {
  NodeOAuthClientProvider,
  OAuthFlowError,
  type NodeOAuthOptions,
} from "./node-provider.js";
export { FileKVStore } from "./file-kv-store.js";
export type { KVStore } from "./kv-store.js";

// Re-export the SDK pieces an orchestrator needs to drive the two-call flow,
// so callers don't need a direct dependency on @modelcontextprotocol/sdk.
export {
  auth,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
