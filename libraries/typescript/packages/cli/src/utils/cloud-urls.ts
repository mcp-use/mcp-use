import type { Deployment } from "./api.js";

const GATEWAY_DOMAIN = "run.mcp-use.com";

export function buildGatewayUrl(slugOrId: string): string {
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
