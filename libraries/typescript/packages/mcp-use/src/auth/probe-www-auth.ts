import { extractWWWAuthenticateParams } from "@modelcontextprotocol/sdk/client/auth.js";

export type ProbeAuthParamsResult = {
  resourceMetadataUrl?: URL;
  scope?: string;
};

/**
 * Probes the MCP endpoint to get a 401 response and extract WWW-Authenticate
 * params (resource_metadata URL and scope). Required for auth scenarios like
 * auth/scope-from-www-authenticate where the client must use scope from the
 * 401 header rather than from PRM.
 */
export async function probeAuthParams(
  serverUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<ProbeAuthParamsResult> {
  const base = serverUrl.replace(/\/$/, "");
  const url = base.endsWith("/mcp") ? base : `${base}/mcp`;
  const response = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "initialize",
      id: 1,
      params: {},
    }),
  });
  if (response.status !== 401) {
    return {};
  }
  const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(response);
  return { resourceMetadataUrl, scope };
}
