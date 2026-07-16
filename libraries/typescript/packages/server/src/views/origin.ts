/**
 * Resolve the public origin for a request — used to build absolute asset URLs
 * in synthesized view documents and CSP metadata.
 *
 * Resolution order:
 * 1. Standard `Forwarded` header (`proto` / `host`)
 * 2. `X-Forwarded-Proto` + `X-Forwarded-Host`
 * 3. The request URL's own origin
 *
 * @remarks
 * An explicit deployment override (v1's `MCP_URL` / a future `publicUrl`
 * config) is deliberately not implemented — see VIEWS_SPEC.md open questions.
 */
export function resolveRequestOrigin(request: Request): string {
  const forwarded = request.headers.get("forwarded");
  if (forwarded !== null) {
    const fromForwarded = parseForwardedHeader(forwarded);
    if (fromForwarded !== undefined) {
      return fromForwarded;
    }
  }

  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host");
  if (proto !== null && host !== null) {
    const firstHost = host.split(",")[0]?.trim();
    const firstProto = proto.split(",")[0]?.trim();
    if (
      firstHost !== undefined &&
      firstProto !== undefined &&
      firstHost !== ""
    ) {
      return `${firstProto}://${firstHost}`;
    }
  }

  return new URL(request.url).origin;
}

function parseForwardedHeader(header: string): string | undefined {
  for (const part of header.split(",")) {
    const params = new Map<string, string>();
    for (const token of part.split(";")) {
      const [key, ...rest] = token.trim().split("=");
      if (key === undefined || rest.length === 0) {
        continue;
      }
      params.set(key.toLowerCase(), rest.join("=").replace(/^"|"$/g, ""));
    }
    const proto = params.get("proto");
    const host = params.get("host");
    if (proto !== undefined && host !== undefined) {
      return `${proto}://${host}`;
    }
  }
  return undefined;
}
