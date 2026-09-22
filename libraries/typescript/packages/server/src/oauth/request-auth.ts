import type { AuthInfo } from "@modelcontextprotocol/server";

import { mapVerifiedAuthInfo } from "./internal.js";
import type { OAuthExtra } from "./provider.js";

/**
 * Authentication delegated to an external engine that verifies the complete request.
 *
 * The engine owns discovery, scope enforcement, proof validation and challenge
 * responses. Mount its authentication and discovery routes separately from the
 * MCP endpoint. This mode cannot be combined with an `oauth` provider.
 */
export interface RequestAuthOptions<TUser> {
  /** Canonical public MCP endpoint URL, whose path must match `basePath`. */
  resource: URL | string;
  /**
   * Verifies the request, including any request-bound token proof, and returns
   * resource-bound authentication information or the engine's rejection response.
   *
   * Responses pass through unchanged. Thrown errors and invalid verifier output
   * fail closed with a generic 503 response without exposing error details.
   * Receives a clone so reading its body leaves the MCP request body available.
   */
  authenticate: (request: Request) => Promise<AuthInfo | Response>;
  /** Maps verified authentication information into user, claims and permissions. */
  mapAuthInfo: (authInfo: AuthInfo) => OAuthExtra<TUser>;
}

/** @internal Wraps request authentication with validated identity mapping and safe failures. */
export function createRequestAuthenticator<TUser>(
  options: RequestAuthOptions<TUser>,
  resource: URL
): (request: Request) => Promise<AuthInfo | Response> {
  return async (request) => {
    let stage = "authenticate";
    try {
      const result = await options.authenticate(request.clone());
      stage = "validateAuthInfo";
      return result instanceof Response
        ? result
        : mapVerifiedAuthInfo(result, resource, (info) => {
            stage = "mapAuthInfo";
            return options.mapAuthInfo(info);
          });
    } catch {
      // Provider errors can contain credentials. Log only our own context.
      console.warn("[mcp-use] Request authentication failed", {
        stage,
        method: request.method,
        resource: resource.href,
      });
      return Response.json(
        { error: "temporarily_unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
  };
}
