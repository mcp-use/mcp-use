/** Standard OAuth/OIDC identity providers behind the shared MCP authorization engine. */

import type {
  Account,
  AuthContext,
  BetterAuthOptions,
  GenericEndpointContext,
} from "better-auth";
import { APIError } from "better-auth/api";
import {
  decryptOAuthToken,
  refreshAccessTokenRequest,
  setTokenUtil,
} from "better-auth/oauth2";
import {
  genericOAuth,
  type GenericOAuthConfig,
  type GenericOAuthUserInfo,
} from "better-auth/plugins/generic-oauth";

import {
  createMcpAuthEngine,
  type McpEngineIdentity,
  type NativeMcpAuth,
  type NativeMcpAuthOptions,
} from "./better-auth-native-engine.js";
import type { NativeOAuthUser } from "./better-auth-native.js";
import { assertSecureHttpUrl, parseAbsoluteUrl } from "./guards.js";

/** Registered upstream client and its OAuth/OIDC endpoints; upstream DCR is not used. */
export interface OAuthMcpProviderOptions {
  /** Client ID already registered with the upstream provider. */
  clientId: string;
  /** Upstream client secret; omit only for a registered public client using PKCE. */
  clientSecret?: string;
  /** OIDC discovery URL. Discovery must supply an issuer and JWKS for verified ID tokens. */
  discoveryUrl?: string;
  /** OAuth authorization URL, required when discovery is omitted. */
  authorizationUrl?: string;
  /** OAuth token URL, required when discovery is omitted. */
  tokenUrl?: string;
  /** Authenticated profile endpoint for plain OAuth, unless `getUserInfo` is supplied. */
  userInfoUrl?: string;
  /** Upstream login scopes, separate from the MCP scopes the client requests. */
  scopes?: readonly string[];
  /** Secret-based token authentication; defaults to form-body authentication. */
  authentication?: "basic" | "post";
  /** Resolves an immutable upstream subject; never use an email address as identity. */
  accountSubject?: GenericOAuthConfig["accountSubject"];
  /** Fetches a trusted provider profile for nonstandard user-info APIs; tokens stay server-side. */
  getUserInfo?: GenericOAuthConfig["getUserInfo"];
  /** Maps the verified profile to Better Auth user fields; an email is required by that engine. */
  mapProfileToUser?: GenericOAuthConfig["mapProfileToUser"];
  /** RFC 7662 status check using this provider's registered client credentials. Requires `strict` policy. */
  introspection?: {
    /** Provider's HTTPS introspection endpoint; loopback HTTP is allowed for development. */
    url: string;
    /** Session-bound token to check. Renewed using that login's refresh credentials when available. */
    tokenType: "access_token" | "refresh_token";
    /** Client-secret authentication at introspection; defaults to `basic`. */
    authentication?: "basic" | "post";
  };
  /**
   * Alternative to introspection for providers with an authoritative account or
   * session-status API. Check the immutable subject without caching or changing
   * credentials. Return `invalid` only for confirmed revocation/disablement and
   * `unavailable` for inconclusive responses. Requires `strict` policy.
   */
  checkStatus?: (
    /** Verified upstream account subject. */
    subject: string,
    /** Aborted on request cancellation or after ten seconds. */
    signal: AbortSignal
  ) => Promise<"valid" | "invalid" | "unavailable">;
}

/** MCP engine configuration with one or more pre-registered upstream OAuth clients. */
export interface OAuthMcpAuthOptions extends Omit<
  NativeMcpAuthOptions,
  "providers" | "sessionPolicy" | "sessionExpiresIn"
> {
  /** Application-chosen provider keys mapped to fixed server-side client configuration. */
  providers: Readonly<Record<string, OAuthMcpProviderOptions>>;
  /**
   * `strict` checks upstream status before every MCP request and token issuance
   * or renewal, without caching success. Each provider needs introspection or
   * `checkStatus`. Outages deny access temporarily; confirmed rejection ends
   * the local session. `independent` accepts only the local session lifetime.
   */
  sessionPolicy: "strict" | "independent";
  /** Maximum MCP session/refresh lifetime in seconds. Required; there is no generic-provider default. */
  sessionExpiresIn: number;
}

/** Shared MCP lifecycle plus the upstream login information needed by an application page. */
export interface OAuthMcpAuth extends NativeMcpAuth {
  /**
   * Upstream callback URLs and provider IDs. Register each callback with its IdP.
   * On `loginPath`, POST `{ provider, callbackURL, oauth_query }` to
   * `${basePath}/sign-in/social`; use this provider ID and resume at
   * `${basePath}/oauth2/authorize?${oauth_query}`. Forward the engine's response.
   */
  readonly upstreamProviders: Readonly<
    Record<
      string,
      {
        /** Engine provider ID supplied to the standard Better Auth social sign-in endpoint. */
        provider: string;
        /** Exact callback URL to register with the upstream provider. */
        callbackUrl: string;
      }
    >
  >;
}

interface ConfiguredProvider {
  key: string;
  source: string;
  config: GenericOAuthConfig;
  introspection?: OAuthMcpProviderOptions["introspection"];
  checkStatus?: OAuthMcpProviderOptions["checkStatus"];
}

interface UpstreamSession {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  upstreamBinding?: string | null;
}

interface UpstreamBinding {
  providerId: string;
  subject: string;
  tokenType: "access_token" | "refresh_token";
  token: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
  refreshingUntil?: number;
  refreshOwner?: string;
  renewed?: boolean;
}

/**
 * Connects standard OAuth/OIDC providers without upstream dynamic registration.
 *
 * Better Auth owns both authorization-code flows, state, PKCE, OIDC verification,
 * consent and token issuance. Applications render the returned login/consent
 * paths, as with `createNativeMcpAuth`. Upstream credentials are encrypted in
 * engine storage and are not exposed through MCP or the engine's token-read APIs.
 *
 * Strict sessions follow the provider's configured status signal as well as
 * their local lifetime. Browser logout is detected only if that signal reflects
 * it. Independent sessions follow only their local lifetime. This does not
 * change Firebase's native-session policy. Equal emails do not link accounts.
 * Changing an upstream endpoint or client ID changes its provider namespace;
 * existing sessions for the old configuration cannot obtain new MCP tokens.
 */
export async function createOAuthMcpAuth(
  options: OAuthMcpAuthOptions
): Promise<OAuthMcpAuth> {
  const { providers, sessionPolicy, sessionExpiresIn, ...commonOptions } =
    options;
  if (sessionPolicy !== "independent" && sessionPolicy !== "strict") {
    throw new TypeError(
      "Choose an explicit generic OAuth sessionPolicy: 'strict' or 'independent'"
    );
  }
  if (!Number.isSafeInteger(sessionExpiresIn) || sessionExpiresIn <= 0) {
    throw new TypeError(
      "Choose an explicit positive sessionExpiresIn for generic OAuth"
    );
  }
  const engineOptions = { ...commonOptions, sessionExpiresIn };
  const configured = await Promise.all(
    Object.entries(providers).map(async ([key, provider]) => {
      if (
        !/^[a-z][a-z0-9-]{0,63}$/.test(key) ||
        !provider ||
        typeof provider.clientId !== "string" ||
        !provider.clientId ||
        (provider.clientSecret !== undefined &&
          (typeof provider.clientSecret !== "string" || !provider.clientSecret))
      ) {
        throw new TypeError(
          "OAuth providers need a valid key and registered client credentials"
        );
      }
      const introspection = provider.introspection
        ? {
            ...provider.introspection,
            url: endpoint(provider.introspection.url),
          }
        : undefined;
      if (
        (sessionPolicy === "strict" &&
          Boolean(introspection) === Boolean(provider.checkStatus)) ||
        (sessionPolicy === "independent" &&
          (introspection || provider.checkStatus)) ||
        (provider.checkStatus !== undefined &&
          typeof provider.checkStatus !== "function") ||
        (introspection &&
          (!introspection.url ||
            !provider.clientSecret ||
            !["access_token", "refresh_token"].includes(
              introspection.tokenType
            ) ||
            ![undefined, "basic", "post"].includes(
              introspection.authentication
            )))
      ) {
        throw new TypeError(
          "Strict OAuth providers need exactly one status check: introspection with client credentials and a token type, or checkStatus"
        );
      }
      const endpoints = {
        discoveryUrl: endpoint(provider.discoveryUrl),
        authorizationUrl: endpoint(provider.authorizationUrl),
        tokenUrl: endpoint(provider.tokenUrl),
        userInfoUrl: endpoint(provider.userInfoUrl),
      };
      if (
        !endpoints.discoveryUrl &&
        (!endpoints.authorizationUrl ||
          !endpoints.tokenUrl ||
          (!endpoints.userInfoUrl && !provider.getUserInfo))
      ) {
        throw new TypeError(
          "Configure OIDC discovery or OAuth authorization, token and user-info endpoints"
        );
      }
      const configuration = JSON.stringify([
        "oauth",
        endpoints,
        provider.clientId,
      ]);
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(configuration)
      );
      const suffix = [...new Uint8Array(digest).slice(0, 12)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const config: GenericOAuthConfig = {
        ...endpoints,
        providerId: `${key}-${suffix}`,
        name: key,
        clientId: provider.clientId,
        clientSecret: provider.clientSecret,
        scopes: provider.scopes ? [...provider.scopes] : [],
        authentication: provider.authentication ?? "post",
        pkce: true,
        requireIdTokenVerification: endpoints.discoveryUrl !== undefined,
        disableProviderLogout: true,
        accountSubject: provider.accountSubject,
        mapProfileToUser: provider.mapProfileToUser,
        getUserInfo:
          provider.getUserInfo ??
          (endpoints.discoveryUrl
            ? undefined
            : async (tokens) => {
                // Plain OAuth identity comes from its authenticated profile API,
                // never from decoding an unverified id_token in a token response.
                if (!tokens.accessToken) return null;
                const response = await fetch(endpoints.userInfoUrl!, {
                  headers: { Authorization: `Bearer ${tokens.accessToken}` },
                  redirect: "error",
                  signal: AbortSignal.timeout(10_000),
                });
                if (!response.ok) return null;
                const profile: unknown = await response.json();
                if (!isRecord(profile)) return null;
                return {
                  ...profile,
                  emailVerified:
                    profile["email_verified"] === true ||
                    profile["emailVerified"] === true,
                  image: profile["picture"] ?? profile["image"],
                } as GenericOAuthUserInfo;
              }),
      };
      // Endpoint query parameters can be sensitive. Only a stable fingerprint
      // belongs in the public identity and MCP tokens.
      const source = JSON.stringify(["oauth", key, suffix]);
      return {
        key,
        source,
        config,
        ...(introspection?.url && {
          introspection: { ...introspection, url: introspection.url },
        }),
        checkStatus: provider.checkStatus?.bind(provider),
      };
    })
  );
  if (!configured.length)
    throw new TypeError("At least one upstream OAuth provider is required");
  const engine = await createMcpAuthEngine(engineOptions, () =>
    upstreamIdentity(configured, sessionExpiresIn, sessionPolicy)
  );
  return {
    ...engine,
    upstreamProviders: Object.fromEntries(
      configured.map(({ key, config }) => [
        key,
        {
          provider: config.providerId,
          callbackUrl: new URL(
            `${engine.basePath}/callback/${config.providerId}`,
            new URL(options.resource).origin
          ).href,
        },
      ])
    ),
  };
}

function upstreamIdentity(
  providers: ConfiguredProvider[],
  sessionExpiresIn: number,
  sessionPolicy: OAuthMcpAuthOptions["sessionPolicy"]
): McpEngineIdentity {
  const byProviderId = new Map(
    providers.map((provider) => [provider.config.providerId, provider])
  );
  const plugin = genericOAuth({
    config: providers.map(({ config }) => config),
  });
  let context: AuthContext;
  // Capture the tokens written by this callback, not the account's latest token
  // after a concurrent login. Better Auth already encrypts these token values.
  const logins = new WeakMap<
    GenericEndpointContext,
    { fresh: Partial<Account>; account?: Account }
  >();
  const captureTokens = async (
    fresh: Partial<Account>,
    ctx: GenericEndpointContext | null
  ) => {
    if (ctx && sessionPolicy === "strict") logins.set(ctx, { fresh });
  };
  const captureAccount = async (
    account: Account,
    ctx: GenericEndpointContext | null
  ) => {
    const login = ctx && logins.get(ctx);
    if (login) login.account = account;
  };
  const databaseHooks: NonNullable<BetterAuthOptions["databaseHooks"]> = {
    account: {
      create: { before: captureTokens, after: captureAccount },
      update: { before: captureTokens, after: captureAccount },
    },
    session: {
      create: {
        async before(session, ctx) {
          if (sessionPolicy !== "strict") return;
          const login = ctx && logins.get(ctx);
          if (ctx) logins.delete(ctx);
          const account = login?.account;
          const provider = account && byProviderId.get(account.providerId);
          const token =
            provider?.introspection?.tokenType === "refresh_token"
              ? login?.fresh.refreshToken
              : login?.fresh.accessToken;
          const tokenExpiry =
            provider?.introspection?.tokenType === "refresh_token"
              ? login?.fresh.refreshTokenExpiresAt
              : login?.fresh.accessTokenExpiresAt;
          if (
            !account ||
            account.userId !== session.userId ||
            !provider ||
            login?.fresh.providerId !== account.providerId ||
            !account.accountId ||
            (provider.introspection && !token)
          ) {
            throw invalidGrant();
          }
          return {
            data: {
              ...session,
              upstreamBinding: JSON.stringify({
                providerId: account.providerId,
                subject: account.accountId,
                ...(provider.introspection && {
                  tokenType: provider.introspection.tokenType,
                  token,
                  refreshToken: login.fresh.refreshToken ?? undefined,
                  ...(tokenExpiry
                    ? { tokenExpiresAt: tokenExpiry.getTime() / 1000 }
                    : {}),
                }),
              }),
            },
          };
        },
      },
    },
  };
  async function readSession(
    sessionId: string,
    userId: string
  ): Promise<UpstreamSession> {
    const session = await context.adapter.findOne<UpstreamSession>({
      model: "session",
      where: [{ field: "id", value: sessionId }],
    });
    const expiresAt = session
      ? Math.min(
          session.expiresAt.getTime(),
          session.createdAt.getTime() + sessionExpiresIn * 1000
        )
      : NaN;
    if (
      !session ||
      session.userId !== userId ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      throw invalidGrant();
    }
    return session;
  }
  async function identity(
    sessionId: string,
    userId: string,
    signal?: AbortSignal,
    renewUpstream = false
  ): Promise<NativeOAuthUser> {
    const session = await readSession(sessionId, userId);
    const accounts = await context.internalAdapter.findAccounts(userId);
    const account = accounts.length === 1 ? accounts[0] : undefined;
    const provider = account && byProviderId.get(account.providerId);
    const user = await context.internalAdapter.findUserById(userId);
    if (!provider || !account?.accountId || !user) {
      throw invalidGrant();
    }
    if (sessionPolicy === "strict") {
      const binding: unknown = JSON.parse(session.upstreamBinding ?? "null");
      if (
        !isRecord(binding) ||
        binding["providerId"] !== account.providerId ||
        binding["subject"] !== account.accountId ||
        (provider.introspection &&
          (binding["tokenType"] !== provider.introspection.tokenType ||
            typeof binding["token"] !== "string" ||
            !binding["token"]))
      ) {
        throw invalidGrant();
      }
      const status = await checkUpstreamStatus(async (checkSignal) => {
        if (provider.checkStatus)
          return provider.checkStatus(account.accountId, checkSignal);
        let stored = binding as unknown as UpstreamBinding;
        if ((stored.refreshingUntil ?? 0) > Date.now()) return "unavailable";
        const expired =
          typeof stored.tokenExpiresAt === "number" &&
          stored.tokenExpiresAt <= Date.now() / 1000;
        const renew = async () => {
          session.upstreamBinding = await renewBinding(
            session,
            stored,
            provider,
            checkSignal
          );
          stored = JSON.parse(session.upstreamBinding) as UpstreamBinding;
        };
        if (expired) await renew();
        let checked = await introspect(
          provider,
          account.accountId,
          await decryptOAuthToken(stored.token, context),
          checkSignal,
          stored.renewed
        );
        if (checked.status !== "valid") return checked.status;
        if (
          renewUpstream &&
          !expired &&
          (stored.refreshToken || stored.tokenType === "refresh_token")
        ) {
          await renew();
          checked = await introspect(
            provider,
            account.accountId,
            await decryptOAuthToken(stored.token, context),
            checkSignal,
            true
          );
          if (checked.status !== "valid") return checked.status;
        }
        if (
          checked.expiresAt !== undefined &&
          checked.expiresAt !== stored.tokenExpiresAt
        ) {
          const updated = JSON.stringify({
            ...stored,
            tokenExpiresAt: checked.expiresAt,
          });
          if (checkSignal.aborted) return "unavailable";
          const changed = await context.adapter.updateMany({
            model: "session",
            where: [
              { field: "id", value: session.id },
              { field: "upstreamBinding", value: session.upstreamBinding! },
            ],
            update: { upstreamBinding: updated },
          });
          if (changed !== 1) return "unavailable";
          session.upstreamBinding = updated;
        }
        return "valid";
      }, signal);
      if (status === "invalid") {
        await context.adapter.deleteMany({
          model: "session",
          where: [
            { field: "id", value: session.id },
            { field: "userId", value: userId },
            { field: "upstreamBinding", value: session.upstreamBinding! },
          ],
        });
        throw invalidGrant();
      }
      if (status !== "valid") throw unavailable();
      const current = await readSession(sessionId, userId);
      if (current.upstreamBinding !== session.upstreamBinding)
        throw unavailable();
      if (signal?.aborted) throw unavailable();
    }
    return {
      source: provider.source,
      subject: account.accountId,
      profile: {
        email: user.email,
        emailVerified: user.emailVerified,
        name: user.name,
        ...(user.image ? { image: user.image } : {}),
      },
    };
  }

  async function renewBinding(
    session: UpstreamSession,
    binding: UpstreamBinding,
    provider: ConfiguredProvider,
    signal: AbortSignal
  ): Promise<string> {
    const refreshToken =
      binding.refreshToken ??
      (binding.tokenType === "refresh_token" ? binding.token : undefined);
    if (!refreshToken) throw invalidGrant();
    const until = Date.now() + 45_000;
    const locked = JSON.stringify({
      ...binding,
      refreshingUntil: until,
      refreshOwner: crypto.randomUUID(),
    });
    const original = session.upstreamBinding!;
    const owned = [
      { field: "id", value: session.id },
      { field: "userId", value: session.userId },
      { field: "upstreamBinding", value: locked },
    ];
    if (signal.aborted) throw unavailable();
    const acquired = await context.adapter.updateMany({
      model: "session",
      where: [
        ...owned.slice(0, 2),
        { field: "upstreamBinding", value: original },
        { field: "expiresAt", operator: "gt", value: new Date() },
      ],
      update: { upstreamBinding: locked },
    });
    if (acquired !== 1) throw unavailable();
    try {
      let tokenUrl = provider.config.tokenUrl;
      if (!tokenUrl && provider.config.discoveryUrl) {
        const response = await fetch(provider.config.discoveryUrl, {
          signal,
          redirect: "error",
        });
        if (!response.ok) throw unavailable();
        const metadata: unknown = await response.json();
        tokenUrl =
          isRecord(metadata) && typeof metadata["token_endpoint"] === "string"
            ? endpoint(metadata["token_endpoint"])
            : undefined;
      }
      if (!tokenUrl) throw unavailable();
      const request = await refreshAccessTokenRequest({
        refreshToken: await decryptOAuthToken(refreshToken, context),
        options: {
          clientId: provider.config.clientId,
          clientSecret: provider.config.clientSecret,
        },
        authentication: provider.config.authentication,
        tokenEndpoint: tokenUrl,
      });
      const response = await fetch(tokenUrl, {
        ...request,
        method: "POST",
        signal,
        redirect: "error",
        cache: "no-store",
      });
      const tokens: unknown = await response.json();
      if (!response.ok) {
        if (
          response.status === 400 &&
          isRecord(tokens) &&
          tokens["error"] === "invalid_grant"
        )
          throw invalidGrant();
        throw unavailable();
      }
      if (
        !isRecord(tokens) ||
        typeof tokens["access_token"] !== "string" ||
        !tokens["access_token"] ||
        (tokens["refresh_token"] !== undefined &&
          (typeof tokens["refresh_token"] !== "string" ||
            !tokens["refresh_token"]))
      )
        throw unavailable();
      const replacementRefresh =
        tokens["refresh_token"] === undefined
          ? refreshToken
          : await setTokenUtil(tokens["refresh_token"], context);
      const selected =
        binding.tokenType === "access_token"
          ? await setTokenUtil(tokens["access_token"], context)
          : replacementRefresh;
      if (
        typeof selected !== "string" ||
        typeof replacementRefresh !== "string"
      )
        throw unavailable();
      const lifetime =
        tokens[
          binding.tokenType === "access_token"
            ? "expires_in"
            : "refresh_token_expires_in"
        ];
      const updated = JSON.stringify({
        providerId: binding.providerId,
        subject: binding.subject,
        tokenType: binding.tokenType,
        token: selected,
        refreshToken: replacementRefresh,
        ...(typeof lifetime === "number" &&
        Number.isFinite(lifetime) &&
        lifetime > 0
          ? { tokenExpiresAt: Math.floor(Date.now() / 1000) + lifetime }
          : {}),
        renewed: true,
      } satisfies UpstreamBinding);
      if (signal.aborted || Date.now() >= until) throw unavailable();
      const changed = await context.adapter.updateMany({
        model: "session",
        where: [
          ...owned,
          { field: "expiresAt", operator: "gt", value: new Date() },
        ],
        update: { upstreamBinding: updated },
      });
      if (changed !== 1) throw unavailable();
      return updated;
    } catch (error) {
      if (
        !signal.aborted &&
        error instanceof APIError &&
        error.body?.error === "invalid_grant"
      ) {
        await context.adapter.deleteMany({ model: "session", where: owned });
      } else {
        await context.adapter.updateMany({
          model: "session",
          where: owned,
          update: { upstreamBinding: original },
        });
      }
      throw error;
    }
  }
  return {
    plugin: {
      ...plugin,
      schema: {
        session: {
          fields: {
            upstreamBinding: {
              type: "string",
              required: false,
              input: false,
              returned: false,
            },
          },
        },
      },
      async init(ctx) {
        context = ctx;
        const result = await plugin.init(ctx);
        if (
          providers.some(
            ({ config }) =>
              !result.context.socialProviders.some(
                (provider) => provider.id === config.providerId
              )
          )
        ) {
          throw new TypeError(
            "Upstream OAuth discovery did not register every configured provider"
          );
        }
        return { ...result, options: { databaseHooks } };
      },
    },
    disabledPaths: [
      "/link-social",
      "/unlink-account",
      "/get-access-token",
      "/refresh-token",
    ],
    extension: {
      claims: {
        async accessToken({ sessionId, user, ctx, grantType }) {
          try {
            if (!sessionId || !user) throw invalidGrant();
            return {
              native_identity: await identity(
                sessionId,
                user.id,
                ctx.request?.signal,
                grantType === "refresh_token"
              ),
            };
          } catch (error) {
            if (error instanceof APIError) throw error;
            throw unavailable();
          }
        },
      },
    },
    async checkSession(claims, request) {
      if (request.signal.aborted) return "unavailable";
      if (typeof claims.sid !== "string" || typeof claims.sub !== "string")
        return "invalid";
      try {
        const current = await identity(claims.sid, claims.sub, request.signal);
        const claimed = claims["native_identity"];
        return isRecord(claimed) &&
          claimed["source"] === current.source &&
          claimed["subject"] === current.subject
          ? "valid"
          : "invalid";
      } catch (error) {
        return error instanceof APIError &&
          error.body?.error === "invalid_grant"
          ? "invalid"
          : "unavailable";
      }
    },
    mapAuthInfo(info) {
      const payload = info.extra?.payload;
      if (!isRecord(payload))
        throw new TypeError("Missing verified upstream claims");
      const user = payload["native_identity"];
      if (
        !isRecord(user) ||
        typeof user["source"] !== "string" ||
        typeof user["subject"] !== "string" ||
        !isRecord(user["profile"])
      ) {
        throw new TypeError("Missing verified upstream identity");
      }
      return {
        user: user as unknown as NativeOAuthUser,
        payload,
        permissions: [...info.scopes],
      };
    },
  };
}

function invalidGrant(): APIError {
  return new APIError("BAD_REQUEST", {
    error: "invalid_grant",
    error_description: "Upstream session is invalid; sign in again",
  });
}

function unavailable(): APIError {
  return new APIError("SERVICE_UNAVAILABLE", {
    error: "temporarily_unavailable",
    error_description: "Upstream identity verification is unavailable",
  });
}

async function checkUpstreamStatus(
  check: (signal: AbortSignal) => Promise<"valid" | "invalid" | "unavailable">,
  requestSignal?: AbortSignal
): Promise<"valid" | "invalid" | "unavailable"> {
  if (requestSignal?.aborted) return "unavailable";
  const controller = new AbortController();
  const abort = () => controller.abort();
  requestSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 10_000);
  let onAbort: (() => void) | undefined;
  try {
    const aborted = new Promise<"unavailable">((resolve) => {
      onAbort = () => resolve("unavailable");
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    const status = await Promise.race([check(controller.signal), aborted]);
    return controller.signal.aborted ? "unavailable" : status;
  } catch (error) {
    return !controller.signal.aborted &&
      error instanceof APIError &&
      error.body?.error === "invalid_grant"
      ? "invalid"
      : "unavailable";
  } finally {
    clearTimeout(timer);
    requestSignal?.removeEventListener("abort", abort);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
  }
}

async function introspect(
  provider: ConfiguredProvider,
  subject: string,
  token: string,
  signal: AbortSignal,
  requireSubject = false
): Promise<{
  status: "valid" | "invalid" | "unavailable";
  expiresAt?: number;
}> {
  const { url, tokenType, authentication = "basic" } = provider.introspection!;
  const body = new URLSearchParams({ token, token_type_hint: tokenType });
  const headers = new Headers({
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  });
  if (authentication === "post") {
    body.set("client_id", provider.config.clientId);
    body.set("client_secret", provider.config.clientSecret!);
  } else {
    const encode = (value: string) =>
      new URLSearchParams({ value }).toString().slice("value=".length);
    headers.set(
      "Authorization",
      `Basic ${btoa(`${encode(provider.config.clientId)}:${encode(provider.config.clientSecret!)}`)}`
    );
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal,
    redirect: "error",
    cache: "no-store",
  });
  // HTTP 401 here rejects our introspection credentials, not the user's token.
  if (!response.ok) return { status: "unavailable" };
  const result: unknown = await response.json();
  if (!isRecord(result)) return { status: "unavailable" };
  if (result["active"] === false) return { status: "invalid" };
  if (
    result["active"] !== true ||
    (requireSubject && typeof result["sub"] !== "string") ||
    (result["sub"] !== undefined && typeof result["sub"] !== "string") ||
    (result["client_id"] !== undefined &&
      typeof result["client_id"] !== "string") ||
    (result["exp"] !== undefined &&
      (typeof result["exp"] !== "number" ||
        !Number.isSafeInteger(result["exp"])))
  )
    return { status: "unavailable" };
  if (
    (result["sub"] !== undefined && result["sub"] !== subject) ||
    (result["client_id"] !== undefined &&
      result["client_id"] !== provider.config.clientId) ||
    (typeof result["exp"] === "number" && result["exp"] <= Date.now() / 1000)
  )
    return { status: "invalid" };
  return {
    status: "valid",
    ...(typeof result["exp"] === "number" ? { expiresAt: result["exp"] } : {}),
  };
}

function endpoint(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const url = parseAbsoluteUrl(value, "OAuth provider endpoint");
  assertSecureHttpUrl(url, "OAuth provider endpoint");
  if (url.hash)
    throw new Error("OAuth provider endpoint must not include a fragment");
  return url.href;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
