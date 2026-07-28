/**
 * Resolve the canonical public MCP endpoint from its public origin and the
 * server's exact mount path.
 *
 * `MCP_URL` is intentionally an origin, while `basePath` owns the endpoint
 * path. Resolving them here keeps OAuth identities, landing-page links, and
 * View metadata from appending or dropping the path independently.
 *
 * @internal
 */
export function resolveMcpEndpointUrl(
  origin: string | URL,
  basePath: string
): URL {
  return new URL(basePath, `${new URL(origin).origin}/`);
}
