declare const __MCP_USE_CLI_VERSION__: string;
declare const __MCP_USE_POSTHOG_HOST__: string;
declare const __MCP_USE_POSTHOG_KEY__: string;

/** Public ingestion endpoint shared by usage analytics and explicit feedback. */
export function posthogEndpoint(): string {
  return `${__MCP_USE_POSTHOG_HOST__}/i/v0/e/`;
}

/** Build an anonymous event without reading account or project information. */
export function posthogEvent(
  event: string,
  installation: string,
  properties: Record<string, unknown>
) {
  return {
    api_key: __MCP_USE_POSTHOG_KEY__,
    event,
    distinct_id: `cli:${installation}`,
    timestamp: new Date().toISOString(),
    properties: {
      ...properties,
      cli_version: __MCP_USE_CLI_VERSION__,
      platform: process.platform,
      arch: process.arch,
      node_version: process.versions.node,
      is_ci: Boolean(
        process.env.CI && !["false", "0"].includes(process.env.CI.toLowerCase())
      ),
      is_interactive: Boolean(process.stdin.isTTY),
      $process_person_profile: false,
      $geoip_disable: true,
    },
  };
}
