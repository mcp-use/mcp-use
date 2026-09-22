/** Runs authentication before the MCP server parses or logs a request. */
export function createRequestHandler(options: {
  /** Fixed public origin; forwarding headers cannot change it. */
  origin: string;
  /** Handles authentication routes, returning undefined for other paths. */
  auth: (request: Request) => Promise<Response | undefined>;
  /** Existing MCP server Fetch handler. */
  mcp: (request: Request) => Promise<Response>;
}): (
  request: Request,
  connection?: { incoming: { socket: { remoteAddress?: string | undefined } } }
) => Promise<Response> {
  const canonical = new URL(options.origin);
  if (
    !["https:", "http:"].includes(canonical.protocol) ||
    canonical.pathname !== "/" ||
    canonical.search ||
    canonical.hash ||
    canonical.username ||
    canonical.password
  ) {
    throw new TypeError("The public origin must be an HTTP(S) origin");
  }

  return async (request, connection) => {
    const url = new URL(request.url);
    if (
      request.headers.get("host")?.toLowerCase() !== canonical.host ||
      url.host !== canonical.host ||
      url.username ||
      url.password
    ) {
      return new Response("Invalid Host header", {
        status: 403,
        headers: { "Cache-Control": "no-store", Connection: "close" },
      });
    }
    // Trust the socket for rate limiting, never a caller's forwarded headers.
    const headers = new Headers(request.headers);
    headers.set(
      "x-mcp-peer-ip",
      connection?.incoming.socket.remoteAddress ?? "unknown"
    );
    // A TLS proxy may reach this listener over HTTP while preserving Host.
    url.protocol = canonical.protocol;
    const init: RequestInit & { duplex: "half" } = {
      method: request.method,
      headers,
      body: request.body,
      signal: request.signal,
      duplex: "half",
    };
    request = new Request(url, init);
    return (await options.auth(request)) ?? options.mcp(request);
  };
}
