import type { AuthInfo, ServerContext } from "@modelcontextprotocol/server";

/**
 * Per-request context passed to tool/resource/prompt callbacks.
 */
export type OAuthAuth<TUser> = {
  user: TUser;
  payload: Record<string, unknown>;
  accessToken: string;
  scopes: string[];
  permissions: string[];
  /**
   * The OAuth client identifier from the token's `client_id` or `azp` claim;
   * undefined when the identity provider's access tokens carry no client claim
   * (e.g. WorkOS AuthKit, Supabase).
   */
  clientId?: string;
  expiresAt: number;
  resource?: URL;
};

/**
 * Per-request callback context, authenticated when OAuth is configured.
 */
export type RequestContext<TUser = never, HasOAuth extends boolean = false> =
  HasOAuth extends true
    ? { signal: AbortSignal; request?: Request; auth: OAuthAuth<TUser> }
    : { signal: AbortSignal; request?: Request; auth?: never };

type OAuthExtra<TUser> = Record<string, unknown> & {
  user: TUser;
  payload: Record<string, unknown>;
  permissions: string[];
};

type MappedOAuthAuthInfo<TUser> = AuthInfo & {
  expiresAt: number;
  extra: OAuthExtra<TUser>;
};

function requireOAuthAuthInfo<TUser>(
  authInfo: AuthInfo | undefined
): asserts authInfo is MappedOAuthAuthInfo<TUser> {
  const extra = authInfo?.extra;
  if (
    authInfo === undefined ||
    extra === undefined ||
    typeof extra !== "object" ||
    extra === null ||
    !("user" in extra) ||
    !("payload" in extra) ||
    extra.payload === null ||
    typeof extra.payload !== "object" ||
    Array.isArray(extra.payload) ||
    !("permissions" in extra) ||
    !Array.isArray(extra.permissions) ||
    !extra.permissions.every((permission) => typeof permission === "string") ||
    typeof authInfo.token !== "string" ||
    !Array.isArray(authInfo.scopes) ||
    !authInfo.scopes.every((scope) => typeof scope === "string") ||
    typeof authInfo.clientId !== "string" ||
    typeof authInfo.expiresAt !== "number" ||
    !Number.isFinite(authInfo.expiresAt) ||
    (authInfo.resource !== undefined && !(authInfo.resource instanceof URL))
  ) {
    throw new Error("OAuth callback did not receive mapped AuthInfo.extra");
  }
}

/**
 * Derive the callback-facing {@link RequestContext} from the SDK's
 * per-request `ServerContext`.
 *
 * @internal
 */
export function toRequestContext(ctx: ServerContext): RequestContext<never, false> {
  const request = ctx.http?.req;
  return {
    signal: ctx.mcpReq.signal,
    ...(request !== undefined && { request }),
  };
}

/** @internal Projects mapped OAuth auth information into callback context. */
export function toAuthenticatedRequestContext<TUser>(
  ctx: ServerContext
): RequestContext<TUser, true> {
  const request = ctx.http?.req;
  const authInfo = ctx.http?.authInfo;
  requireOAuthAuthInfo<TUser>(authInfo);
  return {
    signal: ctx.mcpReq.signal,
    ...(request !== undefined && { request }),
    auth: {
      user: authInfo.extra.user,
      payload: authInfo.extra.payload,
      accessToken: authInfo.token,
      scopes: [...authInfo.scopes],
      permissions: [...authInfo.extra.permissions],
      ...(authInfo.clientId.length > 0 && { clientId: authInfo.clientId }),
      expiresAt: authInfo.expiresAt,
      ...(authInfo.resource !== undefined && { resource: authInfo.resource }),
    },
  };
}
