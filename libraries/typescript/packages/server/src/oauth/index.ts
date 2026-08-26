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
  createJwtVerifier,
  type JwtVerifierOptions,
  type VerifiedPayload,
} from "./jwt.js";
export {
  oauthCustomProvider,
  type CustomOAuthProviderOptions,
  type DirectOAuthProvider,
  type OAuthExtra,
  type OAuthProvider,
  type OAuthProviderBinding,
  type OAuthResourceOptions,
  type ResourceBoundOAuthProvider,
} from "./provider.js";
export {
  oauthProxy,
  type OAuthProxyConfig,
  type OAuthProxyJsonObject,
  type OAuthProxyJsonValue,
  type OAuthProxyOptions,
  type OAuthProxyTokenEndpointAuthMethod,
  type OAuthProxyUpstreamResourceContext,
  type OAuthProxyUser,
  type OAuthProxyVerifiedToken,
} from "./proxy/provider.js";
export {
  inMemoryOAuthStore,
  type OAuthProxyStore,
  type OAuthProxyStoreCapabilities,
  type OAuthProxyStoreConsumeResult,
  type OAuthProxyStoreCreateResult,
  type OAuthProxyStoreReadResult,
  type OAuthProxyStoreReplaceResult,
  type OAuthProxyStoreTransaction,
} from "./proxy/store.js";
export type {
  OAuthProxyEncryptionKey,
  OAuthProxyEncryptionOptions,
} from "./proxy/encryption.js";
