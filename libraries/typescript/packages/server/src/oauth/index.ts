/**
 * OAuth resource-server helpers and provider configuration for mcp-use.
 *
 * @packageDocumentation
 */
export {
  OAuthError,
  OAuthErrorCode,
  bearerAuthChallengeResponse,
  getOAuthProtectedResourceMetadataUrl,
  oauthMetadataResponse,
  requireBearerAuth,
  verifyBearerToken,
} from "@modelcontextprotocol/server";
export type {
  AuthInfo as OAuthAuthInfo,
  AuthMetadataOptions,
  BearerAuthOptions,
  OAuthMetadata,
  OAuthProtectedResourceMetadata,
  OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

export { bearerAuth, oauthMetadata } from "./adapters.js";
export {
  oauthCustomProvider,
  type CustomOAuthProviderOptions,
  type OAuthExtra,
  type OAuthProvider,
  type OAuthResourceOptions,
} from "./provider.js";
