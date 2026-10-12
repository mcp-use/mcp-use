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
  type OAuthExtra,
  type OAuthMetadataSource,
  type OAuthProviderRouteHandler,
  type OAuthProvider,
  type OAuthProviderHost,
  type OAuthResourceOptions,
} from "./provider.js";
export {
  github,
  google,
  memoryStorage,
  oauthProxy,
  upstream,
  upstreamToken,
  type ConsentPageProps,
  type GitHubUpstreamOptions,
  type GoogleUpstreamOptions,
  type InPageProps,
  type InPageUpstream,
  type OAuthProxyClient,
  type OAuthProxyConsentOptions,
  type OAuthProxyOptions,
  type OAuthProxyProvider,
  type OAuthProxyStorage,
  type RedirectUpstream,
  type Upstream,
  type UpstreamOptions,
  type UpstreamTokenSet,
  type UpstreamUser,
} from "./proxy/index.js";
