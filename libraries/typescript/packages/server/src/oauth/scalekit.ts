/**
 * Verify Scalekit access tokens for an mcp-use resource server.
 *
 * @packageDocumentation
 */

import type { AuthInfo, OAuthMetadata } from "@modelcontextprotocol/server";

import { oauthEnvironmentValue } from "./environment.js";
import {
  createJwtVerifier,
  invalidToken,
  normalizedStrings,
  normalizedProviderUrl,
  payloadFromAuthInfo,
  providerEndpoint,
  requiredString,
} from "./jwt.js";
import {
  oauthCustomProvider,
  type DirectOAuthProvider,
  type OAuthResourceOptions,
} from "./provider.js";

/** Verified Scalekit caller exposed to authenticated MCP callbacks. */
export interface ScalekitOAuthUser {
  /** Token `sub`. A person under authorization_code; the client under client_credentials. */
  id: string;
  /** Distinguishes a person from a machine client so tools do not store a client id as a user id. */
  subjectType: "user" | "machine";
  /** Organization identifier from the access token's `org_id` claim. */
  organizationId?: string;
  /** Session identifier from the access token's `sid` claim. */
  sessionId?: string;
}

/** Configures Scalekit JWT verification and protected-resource metadata. */
export interface ScalekitOAuthProviderOptions extends OAuthResourceOptions {
  /**
   * Scalekit environment URL from the dashboard.
   *
   * @defaultValue `MCP_USE_OAUTH_SCALEKIT_ENVIRONMENT_URL`
   */
  environmentUrl?: URL | string;
  /**
   * MCP resource id (`res_…`). Default JWT audience and the per-server binding.
   *
   * @defaultValue `MCP_USE_OAUTH_SCALEKIT_RESOURCE_ID`
   */
  resourceId?: string;
  /**
   * Extra JWT audience required *together with* the resource id.
   *
   * Default verification only requires `resourceId` in `aud`. Set this when
   * tokens also carry a Server URL and you want both values present. This
   * does not replace the resource-id check.
   */
  audience?: string;
}

/**
 * Creates a provider that verifies Scalekit access tokens and maps their claims.
 *
 * Advertised authorization-server metadata uses the resource-scoped issuer.
 * The verifier accepts both the environment-root issuer and the resource-scoped
 * issuer so tokens survive Scalekit's issuer migration.
 *
 * @param options - Scalekit environment URL, resource id, and resource-server settings. Defaults to v1 environment variables.
 * @returns A provider that verifies Scalekit-issued access tokens against the resource id.
 * @throws An `Error` if environment URL or resource id is missing. Throws a `TypeError` if they are invalid, `resourceId` does not start with `res_`, or `audience` is empty.
 *
 * @example
 * ```ts
 * import { oauthScalekitProvider } from "mcp-use/oauth/scalekit";
 *
 * const oauth = oauthScalekitProvider({
 *   environmentUrl: "https://your-env.scalekit.dev",
 *   resourceId: "res_example",
 * });
 * ```
 */
export function oauthScalekitProvider(
  options: ScalekitOAuthProviderOptions = {}
): DirectOAuthProvider<ScalekitOAuthUser> {
  if (
    options.audience !== undefined &&
    (typeof options.audience !== "string" ||
      options.audience.trim().length === 0)
  ) {
    throw new TypeError("audience must be a non-empty string");
  }

  const environmentUrl =
    options.environmentUrl ??
    oauthEnvironmentValue("MCP_USE_OAUTH_SCALEKIT_ENVIRONMENT_URL");
  if (environmentUrl === undefined) {
    throw new Error("Scalekit environmentUrl is required.");
  }
  const environmentIssuer = normalizedProviderUrl(
    environmentUrl,
    "environmentUrl"
  ).href.replace(/\/$/, "");

  const resourceId = normalizeResourceId(
    options.resourceId ??
      oauthEnvironmentValue("MCP_USE_OAUTH_SCALEKIT_RESOURCE_ID")
  );
  const resourceIssuer = `${environmentIssuer}/resources/${resourceId}`;
  const extraAudience = options.audience?.trim();

  return oauthCustomProvider<ScalekitOAuthUser>({
    ...options,
    createTokenVerifier: (resource) => {
      const verifier = createJwtVerifier({
        issuer: [environmentIssuer, resourceIssuer],
        jwksUrl: new URL(providerEndpoint(environmentIssuer, "keys")),
        resource,
        audience: resourceId,
      });
      if (extraAudience === undefined) {
        return verifier;
      }
      return {
        async verifyAccessToken(token) {
          const authInfo = await verifier.verifyAccessToken(token);
          assertAudienceIncludes(payloadFromAuthInfo(authInfo), extraAudience);
          return authInfo;
        },
      };
    },
    // mcp-use requires this object. Scalekit serves the live AS document.
    // issuer is what protected-resource metadata advertises. The SDK also
    // copies this blob to /.well-known/oauth-authorization-server here.
    oauthMetadata: metadata(environmentIssuer, resourceId, resourceIssuer),
    mapAuthInfo: mapUser,
  });
}

function assertAudienceIncludes(
  payload: Record<string, unknown>,
  expected: string
): void {
  const aud = payload.aud;
  const audiences =
    typeof aud === "string" ? [aud] : Array.isArray(aud) ? aud : [];
  if (!audiences.includes(expected)) {
    throw invalidToken("Token audience does not include configured audience");
  }
}

function normalizeResourceId(value: string | undefined): string {
  if (value === undefined) {
    throw new Error("Scalekit resourceId is required.");
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(
      "resourceId is required. Copy the res_… id from Scalekit → MCP servers. It is the JWT audience."
    );
  }
  const resourceId = value.trim();
  if (!resourceId.startsWith("res_")) {
    throw new TypeError(
      `resourceId must start with "res_" (${resourceId}). A wrong value weakens audience binding.`
    );
  }
  return resourceId;
}

function metadata(
  environmentIssuer: string,
  resourceId: string,
  resourceIssuer: string
): OAuthMetadata {
  return {
    issuer: resourceIssuer,
    authorization_endpoint: providerEndpoint(resourceIssuer, "oauth/authorize"),
    token_endpoint: providerEndpoint(resourceIssuer, "oauth/token"),
    jwks_uri: providerEndpoint(environmentIssuer, "keys"),
    registration_endpoint: `${environmentIssuer}/api/v1/resources/${resourceId}/clients:register`,
    response_types_supported: ["code"],
    grant_types_supported: [
      "authorization_code",
      "client_credentials",
      "refresh_token",
    ],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_post",
      "client_secret_basic",
    ],
    client_id_metadata_document_supported: true,
  } satisfies OAuthMetadata & {
    client_id_metadata_document_supported: true;
  };
}

function mapUser(authInfo: AuthInfo) {
  const payload = payloadFromAuthInfo(authInfo);
  const id = requiredString(payload, "sub");
  if (id === undefined) throw invalidToken("Missing Scalekit subject");
  // User tokens also carry the host `client_id`. Machine only when sub is that client.
  const clientId =
    requiredString(payload, "client_id") ?? requiredString(payload, "azp");
  const subjectType: ScalekitOAuthUser["subjectType"] =
    clientId !== undefined && id === clientId ? "machine" : "user";
  return {
    user: {
      id,
      subjectType,
      ...optional("organizationId", requiredString(payload, "org_id")),
      ...optional("sessionId", requiredString(payload, "sid")),
    },
    payload,
    permissions: normalizedStrings(payload["permissions"]),
  };
}

function optional<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}
