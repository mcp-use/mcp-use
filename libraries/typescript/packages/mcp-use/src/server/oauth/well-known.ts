/**
 * OAuth/OIDC well-known URL helpers.
 *
 * RFC 8414 §3 inserts the well-known segment between host and issuer path:
 *   https://auth.example.com/.well-known/oauth-authorization-server/oauth/2.1
 *
 * OpenID Connect Discovery appends to the issuer:
 *   https://auth.example.com/oauth/2.1/.well-known/openid-configuration
 */

/** Normalized issuer pathname without trailing slash, or "" for root issuers. */
export function getIssuerPath(issuer: string): string {
  const pathname = new URL(issuer).pathname.replace(/\/+$/, "");
  return pathname === "/" ? "" : pathname;
}

/** Upstream OAuth Authorization Server Metadata URL (RFC 8414). */
export function buildOAuthAuthorizationServerMetadataUrl(
  issuer: string
): string {
  const parsed = new URL(issuer);
  const issuerPath = getIssuerPath(issuer);
  return `${parsed.origin}/.well-known/oauth-authorization-server${issuerPath}`;
}

/** Upstream OpenID Provider Configuration URL (OIDC Discovery). */
export function buildOpenIdConfigurationMetadataUrl(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
}

/** Local MCP server mount path for OAuth AS metadata discovery. */
export function buildLocalOAuthAuthorizationServerPath(
  issuerPath: string
): string {
  return `/.well-known/oauth-authorization-server${issuerPath}`;
}
