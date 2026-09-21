/** Shared provider-native login and session linkage for Better Auth. */

import type { OAuthProviderExtension } from "@better-auth/oauth-provider";
import type { AuthInfo } from "@modelcontextprotocol/server";
import type {
  AuthContext,
  BetterAuthPlugin,
  GenericEndpointContext,
  Where,
} from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import {
  constantTimeEqual,
  symmetricDecrypt,
  symmetricEncrypt,
} from "better-auth/crypto";
import type { JWTPayload } from "jose";
import { z } from "zod";

import {
  NativeIdentityError,
  type NativeIdentity,
  type NativeIdentityAdapter,
  type NativeIdentityBinding,
  type NativeIdentityProfile,
} from "./native-identity.js";
import type { OAuthExtra } from "./provider.js";
import { boundedOperation } from "./bounded-operation.js";

/** Public native identity exposed to MCP tools; never includes native credentials. */
export interface NativeOAuthUser {
  /** Fixed provider-instance namespace. */
  source: string;
  /** Stable identity within that namespace. */
  subject: string;
  /** Attributes supplied by the verified identity source. */
  profile: NativeIdentityProfile;
}

/** Configures one native-login bridge shared by multiple identity adapters. */
export interface BetterAuthNativeIdentityOptions {
  /** Browser-visible provider keys mapped to trusted, server-configured adapters. */
  providers: Readonly<Record<string, NativeIdentityAdapter>>;
  /**
   * `linked` checks the native session at every MCP token issuance/renewal.
   * `strict` also checks current native status before every MCP request, without
   * caching successful checks. Providers must implement read-only `checkStatus`.
   * Checks and revalidation time out after ten seconds; outages reject requests
   * temporarily. Expired credentials are renewed under the session lease.
   * `independent` deliberately uses the engine session's own lifetime.
   */
  sessionPolicy: "strict" | "linked" | "independent";
}

/** Shared native login plugin and its OAuth/session integration. */
export interface BetterAuthNativeIdentityIntegration {
  /** Add to the application's Better Auth plugins. Requires database sessions. */
  plugin: BetterAuthPlugin;
  /** Add to the MCP engine plugin's extensions to bind tokens to native identity. */
  extension: OAuthProviderExtension;
  /** Check the engine session and, in strict mode, native status after token verification. */
  checkSession: (
    claims: JWTPayload,
    request: Request
  ) => Promise<"valid" | "invalid" | "unavailable">;
  /** Maps validated native claims into the SDK's tool-facing identity. */
  mapAuthInfo: (authInfo: AuthInfo) => OAuthExtra<NativeOAuthUser>;
}

interface NativeSession {
  id: string;
  userId: string;
  expiresAt: Date;
  nativeProvider: string;
  nativeSource: string;
  nativeSubject: string;
  nativeProfile: string;
  nativeBinding: string | null;
  nativeLeaseOwner: string | null;
  nativeLeaseUntil: number | null;
}

const flowLifetime = 300;
const leaseLifetime = 45;
const keySchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const querySchema = z.string().max(16_384);
const nonceSchema = z.string().regex(/^[a-f0-9]{64}$/);
const bindingSchema = z.json();
const profileSchema = z
  .object({
    email: z.string().min(1).max(512).optional(),
    emailVerified: z.boolean().optional(),
    name: z.string().max(512).optional(),
    image: z.string().max(2048).optional(),
  })
  .transform(
    (profile) =>
      Object.fromEntries(
        Object.entries(profile).filter(([, value]) => value !== undefined)
      ) as NativeIdentityProfile
  );
const publicIdentitySchema = z.object({
  source: z.string().min(1).max(2048),
  subject: z.string().min(1).max(1024),
  profile: profileSchema,
});

/**
 * @internal Reuses the private MCP engine's plugin/session APIs for native logins.
 *
 * The `/native/start` and `/native/sign-in` POST endpoints belong to the auth
 * base path. They bind a browser proof to a chosen provider and OAuth query,
 * consume that handoff through the engine's atomic verification API, and
 * establish an engine session. OAuth codes, consent and tokens stay engine-owned.
 *
 * Database sessions, disabled session-cookie caching and a persistent engine
 * secret are required. Native account email keys are deterministic internal
 * addresses; real optional email is retained only in the native profile, so
 * equal emails from different providers never link accounts automatically.
 * Changing a provider's source invalidates sessions created for its old source.
 */
export function createNativeIdentityBridge(
  options: BetterAuthNativeIdentityOptions
): BetterAuthNativeIdentityIntegration {
  const sessionPolicy = options.sessionPolicy;
  if (!["strict", "linked", "independent"].includes(sessionPolicy)) {
    throw new TypeError("Choose an explicit native sessionPolicy");
  }
  const providers = new Map<string, NativeIdentityAdapter>();
  const configuredProviders = Object.entries(options.providers);
  const sources = new Set<string>();
  if (!configuredProviders.length)
    throw new TypeError("At least one native provider is required");
  for (const [key, adapter] of configuredProviders) {
    const source = adapter?.source;
    if (
      !keySchema.safeParse(key).success ||
      !adapter ||
      typeof source !== "string" ||
      !source ||
      source.length > 2048 ||
      sources.has(source) ||
      typeof adapter.authenticate !== "function" ||
      (sessionPolicy !== "independent" &&
        typeof adapter.revalidate !== "function") ||
      (sessionPolicy === "strict" && typeof adapter.checkStatus !== "function")
    )
      throw new TypeError(
        "Native providers need unique sources and the selected session policy"
      );
    sources.add(source);
    providers.set(key, {
      source,
      authenticate: adapter.authenticate.bind(adapter),
      ...(adapter.revalidate !== undefined && {
        revalidate: adapter.revalidate.bind(adapter),
      }),
      ...(adapter.checkStatus !== undefined && {
        checkStatus: adapter.checkStatus.bind(adapter),
      }),
    });
  }

  let context: AuthContext | undefined;
  const currentContext = () => {
    if (!context) throw new NativeIdentityError("unavailable");
    return context;
  };
  const publicIdentity = (
    provider: string,
    identity: NativeIdentity
  ): NativeOAuthUser => {
    const adapter = providers.get(provider);
    if (!adapter) throw new NativeIdentityError("invalid");
    const parsed = publicIdentitySchema.safeParse({
      source: adapter.source,
      subject: identity.subject,
      profile: identity.profile ?? {},
    });
    if (!parsed.success) throw new NativeIdentityError("invalid");
    return parsed.data;
  };

  async function encodeBinding(
    binding: NativeIdentityBinding | undefined
  ): Promise<string | null> {
    if (binding === undefined) {
      if (sessionPolicy !== "independent")
        throw new NativeIdentityError("invalid");
      return null;
    }
    const parsed = bindingSchema.safeParse(binding);
    if (!parsed.success) throw new NativeIdentityError("invalid");
    const data = JSON.stringify(parsed.data);
    if (typeof data !== "string" || data.length > 16_384)
      throw new NativeIdentityError("invalid");
    return symmetricEncrypt({ key: currentContext().secretConfig, data });
  }

  async function readSession(
    sessionId: string,
    userId: string
  ): Promise<NativeSession> {
    const session = await currentContext().adapter.findOne<NativeSession>({
      model: "session",
      where: [{ field: "id", value: sessionId }],
    });
    if (
      !session ||
      session.userId !== userId ||
      session.expiresAt.getTime() <= Date.now() ||
      !providers.has(session.nativeProvider) ||
      session.nativeSource !== providers.get(session.nativeProvider)?.source ||
      !session.nativeSubject ||
      typeof session.nativeProfile !== "string"
    )
      throw new NativeIdentityError("invalid");
    return session;
  }

  function sessionIdentity(session: NativeSession): NativeOAuthUser {
    return publicIdentity(session.nativeProvider, {
      subject: session.nativeSubject,
      profile: profileSchema.parse(JSON.parse(session.nativeProfile)),
    });
  }

  async function identityForToken(
    sessionId: string,
    userId: string,
    signal: AbortSignal
  ): Promise<NativeOAuthUser> {
    const session = await readSession(sessionId, userId);
    if (signal.aborted) throw new NativeIdentityError("unavailable");
    if (sessionPolicy === "independent") return sessionIdentity(session);
    const adapter = providers.get(session.nativeProvider)!;
    const database = currentContext().adapter;
    const now = Math.floor(Date.now() / 1000);
    if ((session.nativeLeaseUntil ?? 0) > now || !session.nativeBinding) {
      throw new NativeIdentityError("unavailable");
    }
    const owner = randomNonce();
    const until = now + leaseLifetime;
    const base: Where[] = [
      { field: "id", value: session.id },
      { field: "userId", value: session.userId },
      { field: "nativeProvider", value: session.nativeProvider },
      { field: "nativeSource", value: session.nativeSource },
      { field: "nativeSubject", value: session.nativeSubject },
    ];
    const changed = await database.updateMany({
      model: "session",
      where: [
        ...base,
        { field: "expiresAt", operator: "gt", value: new Date() },
        { field: "nativeBinding", value: session.nativeBinding },
        { field: "nativeLeaseOwner", value: session.nativeLeaseOwner ?? null },
        { field: "nativeLeaseUntil", value: session.nativeLeaseUntil ?? null },
      ],
      update: { nativeLeaseOwner: owner, nativeLeaseUntil: until },
    });
    if (changed !== 1) throw new NativeIdentityError("unavailable");
    const owned = (): Where[] => [
      ...base,
      { field: "nativeLeaseOwner", value: owner },
      { field: "nativeLeaseUntil", value: until },
      {
        field: "nativeLeaseUntil",
        operator: "gt",
        value: Math.floor(Date.now() / 1000),
      },
    ];
    try {
      const binding = bindingSchema.parse(
        JSON.parse(
          await symmetricDecrypt({
            key: currentContext().secretConfig,
            data: session.nativeBinding,
          })
        )
      );
      if (signal.aborted) throw new NativeIdentityError("unavailable");
      // Await the provider itself: the token guard must stay held until it stops.
      // The HTTP boundary returns a bounded failure while this call drains.
      const result = await adapter.revalidate!(binding, signal);
      if (signal.aborted || Date.now() >= until * 1000)
        throw new NativeIdentityError("unavailable");
      if (result.status !== "valid")
        throw new NativeIdentityError(result.status);
      if (result.identity.subject !== session.nativeSubject)
        throw new NativeIdentityError("invalid");
      const identity = publicIdentity(session.nativeProvider, result.identity);
      const nativeBinding = await encodeBinding(result.identity.binding);
      if (signal.aborted) throw new NativeIdentityError("unavailable");
      const updated = await database.updateMany({
        model: "session",
        where: [
          ...owned(),
          { field: "expiresAt", operator: "gt", value: new Date() },
        ],
        update: {
          nativeProfile: JSON.stringify(identity.profile),
          nativeBinding,
          nativeLeaseOwner: null,
          nativeLeaseUntil: null,
        },
      });
      if (updated !== 1) throw new NativeIdentityError("unavailable");
      return identity;
    } catch (error) {
      if (
        !signal.aborted &&
        error instanceof NativeIdentityError &&
        error.code === "invalid"
      ) {
        const deleted = await database.deleteMany({
          model: "session",
          where: owned(),
        });
        if (deleted !== 1) throw new NativeIdentityError("unavailable");
      } else {
        await database.updateMany({
          model: "session",
          where: owned(),
          update: { nativeLeaseOwner: null, nativeLeaseUntil: null },
        });
      }
      throw signal.aborted ? new NativeIdentityError("unavailable") : error;
    }
  }

  const extension: OAuthProviderExtension = {
    claims: {
      async accessToken({ sessionId, user, ctx }) {
        try {
          if (!sessionId || !user) throw new NativeIdentityError("invalid");
          const identity = await identityForToken(
            sessionId,
            user.id,
            ctx.request?.signal ?? AbortSignal.timeout(10_000)
          );
          return {
            native_identity: identity,
            email: identity.profile.email,
            email_verified: identity.profile.emailVerified,
            name: identity.profile.name,
            picture: identity.profile.image,
          };
        } catch (error) {
          throw authError(error);
        }
      },
    },
  };

  function browserPost(ctx: GenericEndpointContext): void {
    const origin = new URL(ctx.context.baseURL).origin;
    if (
      ctx.request?.headers.get("origin") !== origin ||
      ctx.request.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    ) {
      throw new APIError("FORBIDDEN", {
        message: "Native login requires a same-origin JSON request",
      });
    }
    ctx.setHeader("Cache-Control", "no-store");
  }

  function browserCookie(ctx: GenericEndpointContext) {
    const base = new URL(ctx.context.baseURL);
    return ctx.context.createAuthCookie("mcp_native_csrf", {
      maxAge: flowLifetime,
      httpOnly: true,
      sameSite: "strict",
      secure: base.protocol === "https:",
      path: base.pathname.replace(/\/$/, "") + "/native",
    });
  }

  const plugin: BetterAuthPlugin = {
    id: "mcp-native-identity",
    init(ctx) {
      if (context && context !== ctx)
        throw new TypeError("Create a native bridge per auth instance");
      if (
        !ctx.options.database ||
        ctx.options.secondaryStorage ||
        ctx.options.session?.cookieCache?.enabled
      ) {
        throw new TypeError(
          "Native identity requires a database and uncached database sessions"
        );
      }
      context = ctx;
    },
    schema: {
      session: {
        fields: {
          nativeProvider: {
            type: "string",
            required: false,
            input: false,
            returned: false,
          },
          nativeSource: {
            type: "string",
            required: false,
            input: false,
            returned: false,
          },
          nativeSubject: {
            type: "string",
            required: false,
            input: false,
            returned: false,
          },
          nativeProfile: {
            type: "string",
            required: false,
            input: false,
            returned: false,
          },
          nativeBinding: {
            type: "string",
            required: false,
            input: false,
            returned: false,
          },
          nativeLeaseOwner: {
            type: "string",
            required: false,
            input: false,
            returned: false,
          },
          nativeLeaseUntil: {
            type: "number",
            required: false,
            input: false,
            returned: false,
          },
        },
      },
    },
    rateLimit: [
      {
        window: 60,
        max: 10,
        pathMatcher: (path) => path.startsWith("/native/"),
      },
    ],
    endpoints: {
      beginNativeIdentity: createAuthEndpoint(
        "/native/start",
        {
          method: "POST",
          body: z.object({ provider: keySchema, oauth_query: querySchema }),
        },
        async (ctx) => {
          browserPost(ctx);
          if (!providers.has(ctx.body.provider))
            throw new APIError("BAD_REQUEST", {
              message: "Unknown identity provider",
            });
          const csrf = randomNonce();
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: `mcp-native:${await digest(csrf)}`,
            value: JSON.stringify({
              provider: ctx.body.provider,
              query: await digest(ctx.body.oauth_query),
            }),
            expiresAt: new Date(Date.now() + flowLifetime * 1000),
          });
          const cookie = browserCookie(ctx);
          await ctx.setSignedCookie(
            cookie.name,
            csrf,
            ctx.context.secret,
            cookie.attributes
          );
          return ctx.json({ csrf });
        }
      ),
      signInNativeIdentity: createAuthEndpoint(
        "/native/sign-in",
        {
          method: "POST",
          body: z.object({
            provider: keySchema,
            proof: z.unknown().optional(),
            oauth_query: querySchema,
            csrf: nonceSchema,
          }),
        },
        async (ctx) => {
          browserPost(ctx);
          const cookie = browserCookie(ctx);
          const nonce = await ctx.getSignedCookie(
            cookie.name,
            ctx.context.secret
          );
          if (
            typeof nonce !== "string" ||
            !constantTimeEqual(nonce, ctx.body.csrf)
          ) {
            throw new APIError("FORBIDDEN", {
              message: "Restart native sign-in",
            });
          }
          const record =
            await ctx.context.internalAdapter.consumeVerificationValue(
              `mcp-native:${await digest(nonce)}`
            );
          if (!record)
            throw new APIError("FORBIDDEN", {
              message: "Native sign-in expired or was already used",
            });
          const flow: unknown = JSON.parse(record.value);
          if (
            !isRecord(flow) ||
            flow.provider !== ctx.body.provider ||
            flow.query !== (await digest(ctx.body.oauth_query))
          ) {
            throw new APIError("FORBIDDEN", {
              message:
                "Native sign-in does not match the authorization request",
            });
          }
          const adapter = providers.get(ctx.body.provider)!;
          try {
            const result = await adapter.authenticate({
              request: ctx.request!,
              proof: ctx.body.proof,
            });
            const identity = publicIdentity(ctx.body.provider, result.identity);
            const binding = await encodeBinding(result.identity.binding);
            const accountKey = {
              providerId: `mcp-native:${await digest(adapter.source)}`,
              accountId: identity.subject,
            };
            const database = ctx.context.internalAdapter;
            let owner = await database.findAccountOwnerByKey(accountKey);
            if (owner?.kind === "orphaned")
              throw new NativeIdentityError("invalid");
            let user = owner?.user;
            if (!user) {
              try {
                ({ user } = await database.createOAuthUser(
                  {
                    email: `${await digest(JSON.stringify([identity.source, identity.subject]))}@native.invalid`,
                    name: identity.profile.name ?? identity.subject,
                    emailVerified: false,
                  },
                  accountKey
                ));
              } catch (error) {
                // Unique account/email constraints arbitrate concurrent first logins.
                owner = await database.findAccountOwnerByKey(accountKey);
                if (owner?.kind !== "owned") throw error;
                user = owner.user;
              }
            }
            const session = await database.createSession(user.id, false, {
              nativeProvider: ctx.body.provider,
              nativeSource: identity.source,
              nativeSubject: identity.subject,
              nativeProfile: JSON.stringify(identity.profile),
              nativeBinding: binding,
              nativeLeaseOwner: null,
              nativeLeaseUntil: null,
            });
            if (!session) throw new NativeIdentityError("unavailable");
            await setSessionCookie(ctx, { user, session });
            for (const value of result.responseHeaders?.getSetCookie() ?? [])
              ctx.responseHeaders.append("Set-Cookie", value);
            ctx.setCookie(cookie.name, "", { ...cookie.attributes, maxAge: 0 });
            return ctx.json({
              success: true,
              url: `${ctx.context.baseURL.replace(/\/$/, "")}/oauth2/authorize?${ctx.body.oauth_query}`,
            });
          } catch (error) {
            throw authError(error);
          }
        }
      ),
    },
  };

  return {
    plugin,
    extension,
    async checkSession(claims, request) {
      return boundedOperation<"valid" | "invalid" | "unavailable">(
        request.signal,
        async (signal) => {
          try {
            if (
              typeof claims.sid !== "string" ||
              typeof claims.sub !== "string"
            )
              return "invalid";
            const native = publicIdentitySchema.safeParse(
              claims["native_identity"]
            );
            if (!native.success) return "invalid";
            let session = await readSession(claims.sid, claims.sub);
            if (
              native.data.subject !== session.nativeSubject ||
              native.data.source !== session.nativeSource
            )
              return "invalid";
            if (sessionPolicy !== "strict") return "valid";
            for (let attempt = 0; attempt < 2; attempt++) {
              if (!session.nativeBinding) return "invalid";
              const binding = bindingSchema.parse(
                JSON.parse(
                  await symmetricDecrypt({
                    key: currentContext().secretConfig,
                    data: session.nativeBinding,
                  })
                )
              );
              if (signal.aborted) return "unavailable";
              const status = await providers.get(session.nativeProvider)!
                .checkStatus!(binding, signal);
              if (signal.aborted) return "unavailable";
              if (status === "expired" && attempt === 0) {
                await identityForToken(session.id, session.userId, signal);
                session = await readSession(session.id, session.userId);
                if (
                  native.data.subject !== session.nativeSubject ||
                  native.data.source !== session.nativeSource
                )
                  return "invalid";
                continue;
              }
              if (status === "invalid") {
                // An older status check must not delete a concurrently renewed binding.
                await currentContext().adapter.deleteMany({
                  model: "session",
                  where: [
                    { field: "id", value: session.id },
                    { field: "userId", value: session.userId },
                    { field: "nativeProvider", value: session.nativeProvider },
                    { field: "nativeSource", value: session.nativeSource },
                    { field: "nativeSubject", value: session.nativeSubject },
                    { field: "nativeBinding", value: session.nativeBinding },
                  ],
                });
                return "invalid";
              }
              if (status !== "valid") return "unavailable";
              // Another worker may have invalidated this session during the remote check.
              const current = await readSession(session.id, session.userId);
              if (
                current.nativeProvider !== session.nativeProvider ||
                current.nativeSource !== session.nativeSource ||
                current.nativeSubject !== session.nativeSubject
              )
                return "invalid";
              if (signal.aborted) return "unavailable";
              return current.nativeBinding === session.nativeBinding
                ? "valid"
                : "unavailable";
            }
            return "unavailable";
          } catch (error) {
            return error instanceof NativeIdentityError &&
              error.code === "invalid"
              ? "invalid"
              : "unavailable";
          }
        },
        () => "unavailable"
      );
    },
    mapAuthInfo(info) {
      const payload = info.extra?.payload;
      if (!isRecord(payload)) throw new NativeIdentityError("invalid");
      const user = publicIdentitySchema.parse(payload["native_identity"]);
      return { user, payload, permissions: [...info.scopes] };
    },
  };
}

function authError(error: unknown): APIError {
  return error instanceof NativeIdentityError && error.code === "invalid"
    ? new APIError("BAD_REQUEST", {
        error: "invalid_grant",
        error_description: "Native session is invalid; sign in again",
      })
    : new APIError("SERVICE_UNAVAILABLE", {
        error: "temporarily_unavailable",
        error_description: "Identity verification is temporarily unavailable",
      });
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(bytes)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

function randomNonce(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
