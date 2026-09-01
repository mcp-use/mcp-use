/**
 * Lane OAuth provider for mcp-use servers.
 *
 * Lane (getonlane.com) is a standard OAuth 2.1 authorization server with an
 * application-level consent gate: every application tool refuses until the
 * calling agent runs the reserved `lane_register_session` tool, which performs
 * a server-side RFC 8693 token exchange and records a connection for the
 * calling credential. This module verifies Lane access tokens and installs
 * that gate, the reserved tools, the auth-guide resource, the root-path
 * protected-resource document, and the step-up instructions.
 *
 * @packageDocumentation
 */
import type {
  AuthInfo,
  OAuthMetadata,
  OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { decodeProtectedHeader } from "jose";

import { oauthEnvironmentValue } from "./environment.js";
import {
  booleanValue,
  createJwtVerifier,
  invalidToken,
  normalizedProviderUrl,
  numberValue,
  payloadFromAuthInfo,
  providerEndpoint,
  requiredString,
  stringValue,
} from "./jwt.js";
import { createLaneTokenExchanger } from "./lane/exchanger.js";
import { createLaneSetup } from "./lane/setup.js";
import {
  LANE_DEFAULT_ISSUER,
  type LaneOAuthProviderOptions,
  type LaneOAuthUser,
} from "./lane/types.js";
import { oauthCustomProvider, type OAuthProvider } from "./provider.js";

export {
  createLaneTokenExchanger,
  type LaneTokenExchangerConfig,
} from "./lane/exchanger.js";
export {
  memoryLaneConnectionStore,
  type MemoryLaneConnectionStore,
} from "./lane/connections.js";
export {
  LANE_AUTH_GUIDE_NAME,
  LANE_AUTH_GUIDE_URI,
  LANE_DEFAULT_ISSUER,
  LANE_PERSONALIZATION_SCOPE,
  LANE_SESSION_INFO_TOOL,
  LANE_STEP_UP_TOOL,
  LANE_TASK_MAX_CHARS,
  type LaneConnectionInput,
  type LaneConnectionKey,
  type LaneConnectionRecord,
  type LaneConnectionStore,
  type LaneEnforcement,
  type LaneGateDecision,
  type LaneGateEvent,
  type LaneOAuthProviderOptions,
  type LaneOAuthUser,
  type LaneTokenExchangeRequest,
  type LaneTokenExchangeResult,
  type LaneTokenExchanger,
} from "./lane/types.js";

/** RFC 9068: an access token says `at+jwt`; an ID token says `JWT`. */
const ACCESS_TOKEN_TYP = "at+jwt";

const DEFAULT_SCOPES_SUPPORTED = [
  "mcp",
  "offline_access",
  "openid",
  "profile",
  "email",
  "phone",
];

/**
 * Creates a Lane OAuth provider.
 *
 * Tokens are verified against Lane's JWKS and must be audienced to this
 * server's canonical resource. Authority for application tools comes from the
 * connection recorded by `lane_register_session`, never from the bearer's own
 * `scope` claim, so `ctx.auth.permissions` is always empty.
 *
 * @param options - Connection store, confidential client credentials, and gate
 * configuration.
 * @returns A provider for an OAuth-enabled MCP server.
 * @throws A `TypeError` when the connection store or client credentials are
 * missing.
 *
 * @example
 * ```ts
 * import { MCPServer } from "mcp-use";
 * import {
 *   memoryLaneConnectionStore,
 *   oauthLaneProvider,
 * } from "mcp-use/oauth/lane";
 *
 * const server = new MCPServer({
 *   name: "storefront",
 *   version: "1.0.0",
 *   oauth: oauthLaneProvider({
 *     resource: "https://shop.example.com/mcp",
 *     connections: memoryLaneConnectionStore(),
 *     scopes: { checkout: "email" },
 *   }),
 * });
 * ```
 */
export function oauthLaneProvider(
  options: LaneOAuthProviderOptions
): OAuthProvider<LaneOAuthUser> {
  const {
    connections,
    clientId: clientIdOption,
    clientSecret: clientSecretOption,
    issuer: issuerOption,
    scopes,
    enforcement,
    onGateEvent,
    sessionInfoTool,
    authGuide,
    exchanger: exchangerOption,
    createTokenVerifier: verifierOption,
    ...resourceOptions
  } = options;

  if (
    connections === null ||
    typeof connections !== "object" ||
    typeof connections.get !== "function" ||
    typeof connections.put !== "function"
  ) {
    throw new TypeError(
      "oauthLaneProvider requires a connections store with get() and put()"
    );
  }

  const issuer = normalizedProviderUrl(
    issuerOption ??
      oauthEnvironmentValue("MCP_USE_OAUTH_LANE_ISSUER") ??
      LANE_DEFAULT_ISSUER,
    "Lane issuer"
  ).href.replace(/\/$/, "");

  const exchanger =
    exchangerOption ??
    (() => {
      const clientId =
        clientIdOption ?? oauthEnvironmentValue("MCP_USE_OAUTH_LANE_CLIENT_ID");
      const clientSecret =
        clientSecretOption ??
        oauthEnvironmentValue("MCP_USE_OAUTH_LANE_CLIENT_SECRET");
      if (clientId === undefined || clientSecret === undefined) {
        throw new TypeError(
          "Lane clientId and clientSecret are required (or set " +
            "MCP_USE_OAUTH_LANE_CLIENT_ID and MCP_USE_OAUTH_LANE_CLIENT_SECRET); " +
            "the token-exchange grant refuses a public client"
        );
      }
      return createLaneTokenExchanger({ clientId, clientSecret, issuer });
    })();

  const scopesSupported =
    resourceOptions.scopesSupported === undefined
      ? DEFAULT_SCOPES_SUPPORTED
      : [...resourceOptions.scopesSupported];
  const oauthMetadata = metadata(issuer, scopesSupported);

  return oauthCustomProvider<LaneOAuthUser>({
    ...resourceOptions,
    scopesSupported,
    createTokenVerifier: (resource) =>
      verifierOption === undefined
        ? laneVerifier(
            createJwtVerifier({
              issuer,
              jwksUrl: new URL(providerEndpoint(issuer, "jwks")),
              resource,
            })
          )
        : verifierOption(resource),
    oauthMetadata,
    mapAuthInfo: mapUser,
    setup: createLaneSetup({
      issuer,
      connections,
      exchanger,
      oauthMetadata,
      scopesSupported,
      ...(resourceOptions.resourceName !== undefined && {
        resourceName: resourceOptions.resourceName,
      }),
      ...(resourceOptions.serviceDocumentationUrl !== undefined && {
        serviceDocumentationUrl: resourceOptions.serviceDocumentationUrl,
      }),
      toolScopes: scopes ?? {},
      enforcement: enforcement ?? "gate-all",
      ...(onGateEvent !== undefined && { onGateEvent }),
      sessionInfoTool: sessionInfoTool ?? true,
      authGuide: authGuide ?? true,
    }),
  });
}

/**
 * Adds the checks Lane requires on top of the shared JWT verifier: the token
 * type must be `at+jwt` so an ID token cannot be replayed as an access token,
 * and `jti` must be present because connections are keyed by it.
 */
function laneVerifier(inner: OAuthTokenVerifier): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let typ: string | undefined;
      try {
        typ = decodeProtectedHeader(token).typ;
      } catch (error) {
        throw invalidToken("Malformed Lane access token", error);
      }
      if (typ !== ACCESS_TOKEN_TYP) {
        throw invalidToken(
          `Lane access token must have typ ${ACCESS_TOKEN_TYP}`
        );
      }
      const authInfo = await inner.verifyAccessToken(token);
      if (requiredString(payloadFromAuthInfo(authInfo), "jti") === undefined) {
        throw invalidToken("Lane access token is missing jti");
      }
      return authInfo;
    },
  };
}

function metadata(issuer: string, scopesSupported: string[]): OAuthMetadata {
  return {
    issuer,
    authorization_endpoint: providerEndpoint(issuer, "authorize"),
    token_endpoint: providerEndpoint(issuer, "token"),
    registration_endpoint: providerEndpoint(issuer, "register"),
    revocation_endpoint: providerEndpoint(issuer, "revoke"),
    jwks_uri: providerEndpoint(issuer, "jwks"),
    response_types_supported: ["code"],
    grant_types_supported: [
      "authorization_code",
      "refresh_token",
      "urn:ietf:params:oauth:grant-type:token-exchange",
    ],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: scopesSupported,
  };
}

function mapUser(authInfo: AuthInfo) {
  const payload = payloadFromAuthInfo(authInfo);
  const id = requiredString(payload, "sub");
  if (id === undefined) throw invalidToken("Missing Lane subject");
  const agentId = requiredString(payload, "client_id");
  if (agentId === undefined) throw invalidToken("Missing Lane client_id");
  const credentialId = requiredString(payload, "jti");
  if (credentialId === undefined) throw invalidToken("Missing Lane jti");

  const host = stringValue(payload, "host");
  const tier = stringValue(payload, "tier");
  const clientVerified = booleanValue(payload, "client_verified");
  const authTime = numberValue(payload, "auth_time");

  return {
    user: {
      id,
      agentId,
      credentialId,
      ...(host !== undefined && { host }),
      ...(tier !== undefined && { tier }),
      ...(clientVerified !== undefined && { clientVerified }),
      ...(authTime !== undefined && { authTime }),
    },
    payload,
    // Authority lives in the recorded connection, never in the bearer.
    permissions: [],
  };
}
