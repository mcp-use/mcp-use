/**
 * Tool-level authentication metadata (SEP-1488 / OpenAI Apps SDK).
 *
 * Declared per tool via `securitySchemes` on the tool definition, or
 * server-wide via `defaultSecuritySchemes` on the server config. The
 * value is emitted as a top-level field on each Tool in the
 * `tools/list` response so ChatGPT-style clients can surface the
 * correct sign-in UI.
 *
 * Two scheme types exist today; list more than one to express
 * optional auth (e.g. `[{ type: "noauth" }, { type: "oauth2", scopes: [...] }]`).
 *
 * The server must still verify tokens, audiences, and scopes on every
 * call — `securitySchemes` is advertisement, not enforcement.
 */
export type SecurityScheme = NoAuthScheme | OAuth2Scheme;

/** Tool is callable anonymously. */
export interface NoAuthScheme {
  type: "noauth";
}

/** Tool requires an OAuth 2.0 access token; scopes flow into the consent screen. */
export interface OAuth2Scheme {
  type: "oauth2";
  scopes?: string[];
}
