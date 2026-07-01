import type { Deployment } from "./api.js";

const GATEWAY_DOMAIN = "run.mcp-use.com";

/** Default base URL for the tunnel-release API. */
const DEFAULT_TUNNEL_API = "https://local.mcp-use.run";

/**
 * Base URL of the tunnel API (subdomain reservation/release for `dev --tunnel`
 * and `start --tunnel`). Overridable via the `MCP_USE_TUNNEL_API` env var.
 *
 * P4 folded the former duplicate `MCP_USE_API` variable into this one — they
 * shared the same default and endpoints — so there is now a single name and a
 * single resolver.
 */
export function tunnelApiBase(): string {
  return process.env.MCP_USE_TUNNEL_API || DEFAULT_TUNNEL_API;
}

function buildGatewayUrl(slugOrId: string): string {
  return `https://${slugOrId}.${GATEWAY_DOMAIN}/mcp`;
}

/** MCP URL for a deployment: explicit `mcpUrl`, else gateway URL from `serverId`. */
export function getMcpServerUrl(deployment: Deployment): string {
  if (deployment.mcpUrl) return deployment.mcpUrl;
  if (deployment.serverId) return buildGatewayUrl(deployment.serverId);
  return "";
}

/**
 * MCP URL for a cloud server row/detail: use API `mcpUrl` when set; otherwise
 * gateway host uses **slug** when present (matches production hostnames), else `id`.
 */
export function getMcpServerUrlForCloudServer(server: {
  mcpUrl?: string | null;
  slug?: string | null;
  id: string;
}): string {
  if (server.mcpUrl) return server.mcpUrl;
  const hostKey = (server.slug && server.slug.trim()) || server.id;
  return buildGatewayUrl(hostKey);
}
