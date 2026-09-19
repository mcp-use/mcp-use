/** Dedicated native-identity MCP engine with application-auth isolation. */

import type { CimdOptions } from "@better-auth/cimd";
import { mcp } from "@better-auth/mcp";
import {
  betterAuth,
  type BetterAuthOptions,
  type BetterAuthPlugin,
} from "better-auth";
import { getAuthTables } from "better-auth/db";
import { jwt } from "better-auth/plugins";

import {
  betterAuthMcp,
  type BetterAuthMcpIntegration,
  type BetterAuthMcpOptions,
} from "./better-auth-mcp.js";
import {
  createNativeIdentityBridge,
  type BetterAuthNativeIdentityIntegration,
  type BetterAuthNativeIdentityOptions,
  type NativeOAuthUser,
} from "./better-auth-native.js";
import { validateOAuthResource } from "./internal.js";

/** Connection and identity settings for a separate native MCP authorization engine. */
export interface NativeMcpAuthOptions extends BetterAuthNativeIdentityOptions {
  /** Canonical HTTPS MCP resource; loopback HTTP is allowed for local use. */
  resource: URL | string;
  /**
   * Application-owned SQL connection supported by Better Auth's built-in
   * migrations. Custom adapter functions (such as Prisma/Drizzle adapters) are
   * not supported by this factory. Engine tables are always namespaced.
   */
  database: Exclude<
    NonNullable<BetterAuthOptions["database"]>,
    (...args: never[]) => unknown
  >;
  /** Stable engine secret, at least 32 characters, retained across restarts. */
  secret: string;
  /** Scopes the engine may issue. */
  scopes: readonly string[];
  /** Scopes required to call the MCP endpoint. */
  requiredScopes?: readonly string[];
  /** Native engine session and refresh-token lifetime, in seconds; defaults to seven days. */
  sessionExpiresIn?: number;
  /**
   * MCP access-token lifetime, in seconds; defaults to five minutes.
   * Grant revocation stops renewal; issued JWTs can remain valid until expiry.
   */
  accessTokenExpiresIn?: number;
  /** Explicit legacy unauthenticated dynamic-registration fallback; defaults to false. */
  allowDynamicClientRegistration?: boolean;
  /** Runtime-specific, address-pinned CIMD transport; Node apps can use `@better-auth/cimd/node`. */
  fetchClientMetadataResource: CimdOptions["fetchClientMetadataResource"];
  /** Trusted IP headers replaced by the application's HTTP boundary, never accepted directly from callers. */
  ipAddressHeaders?: string[];
  /** Shared token/revocation serialization required for multiple application processes. */
  runTokenOperation?: BetterAuthMcpOptions<NativeOAuthUser>["runTokenOperation"];
}

/** Private-engine lifecycle and routes; no application auth instance or plugin is exposed. */
export interface NativeMcpAuth {
  /** Reserved namespace for the engine's HTTP endpoints. */
  readonly basePath: string;
  /** Application-rendered native login page, outside the engine endpoint namespace. */
  readonly loginPath: string;
  /** Application-rendered consent page, outside the engine endpoint namespace. */
  readonly consentPath: string;
  /** Reports only the engine's namespaced schema; explicit `runMigrations()` also initializes its signing keys. */
  getMigrations: () => ReturnType<
    (typeof import("better-auth/db/migration"))["getMigrations"]
  >;
  /** Connects the migrated engine to MCP with session checks and guarded route handling already installed. */
  connect: () => Promise<BetterAuthMcpIntegration<NativeOAuthUser>>;
}

const optionNames = new Set([
  "resource",
  "database",
  "secret",
  "scopes",
  "requiredScopes",
  "sessionExpiresIn",
  "accessTokenExpiresIn",
  "allowDynamicClientRegistration",
  "fetchClientMetadataResource",
  "ipAddressHeaders",
  "runTokenOperation",
]);

/**
 * Creates a dedicated OAuth engine without modifying an existing app-auth instance.
 *
 * The canonical resource determines stable table, cookie and route namespaces.
 * All database models are scoped, including users, sessions, signing keys and
 * OAuth bookkeeping. The caller may reuse a database connection; this is logical
 * isolation, not a separate database permission boundary. No schema writes occur
 * until the application explicitly runs the returned migrations.
 *
 * Existing unprefixed data is never moved or adopted. Changing the resource creates
 * a new issuer and namespace, so clients must authorize again. Native login pages
 * belong at the returned paths; existing application login remains app-owned.
 * Supply a built-in SQL connection, not a custom database adapter function;
 * the factory's migration/bootstrap lifecycle requires the engine's SQL migrator.
 */
export async function createNativeMcpAuth(
  options: NativeMcpAuthOptions
): Promise<NativeMcpAuth> {
  const { providers, sessionPolicy, ...engineOptions } = options;
  return createMcpAuthEngine(engineOptions, () =>
    createNativeIdentityBridge({
      providers,
      sessionPolicy,
    })
  );
}

/** @internal Identity integration and any engine endpoints it must disable. */
export type McpEngineIdentity = BetterAuthNativeIdentityIntegration & {
  /** Engine-relative paths unavailable for this identity integration. */
  disabledPaths?: readonly string[];
};

/** @internal Shared storage, OAuth and lifecycle setup for MCP identity factories. */
export async function createMcpAuthEngine(
  options: Omit<NativeMcpAuthOptions, "providers" | "sessionPolicy">,
  createIdentity: () => McpEngineIdentity
): Promise<NativeMcpAuth> {
  for (const key of Object.keys(options)) {
    if (!optionNames.has(key))
      throw new TypeError(`Unsupported native MCP auth option: ${key}`);
  }
  if (typeof options.database === "function") {
    throw new TypeError(
      "Native MCP auth requires a built-in SQL connection; custom database adapter functions are not supported"
    );
  }
  const resource = validateOAuthResource(
    options.resource,
    new URL(options.resource).pathname
  );
  if (
    !options.database ||
    typeof options.secret !== "string" ||
    options.secret.length < 32
  ) {
    throw new TypeError(
      "Native MCP auth requires a database and a stable secret of at least 32 characters"
    );
  }
  const sessionExpiresIn = options.sessionExpiresIn ?? 7 * 24 * 60 * 60;
  const accessTokenExpiresIn = options.accessTokenExpiresIn ?? 300;
  if (
    ![sessionExpiresIn, accessTokenExpiresIn].every(
      (value) => Number.isSafeInteger(value) && value > 0
    ) ||
    accessTokenExpiresIn > sessionExpiresIn
  ) {
    throw new TypeError(
      "Token lifetimes must be positive whole seconds within the session lifetime"
    );
  }
  const scopes = [...options.scopes];
  if (
    scopes.length === 0 ||
    scopes.some(
      (scope) =>
        typeof scope !== "string" || !/^[\x21\x23-\x5B\x5D-\x7E]+$/.test(scope)
    ) ||
    options.requiredScopes?.some((scope) => !scopes.includes(scope))
  ) {
    throw new TypeError(
      "Native MCP auth needs valid scopes containing every required scope"
    );
  }
  const hash = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(resource.href)
    )
  );
  const id = Array.from(hash.slice(0, 10), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
  const prefix = `mcp_${id}_`;
  const rootPath = `/mcp-auth/${id}`;
  const basePath = `${rootPath}/auth`;
  const loginPath = `${rootPath}/login`;
  const consentPath = `${rootPath}/consent`;
  const model = (name: string) => ({ modelName: `${prefix}${name}` });
  const { cimd } = await import("@better-auth/cimd");
  const bridge = createIdentity();
  // jwt({ schema }) in engine 1.7.4 mutates module-shared metadata. Override the
  // returned plugin's own metadata instead, preserving other auth instances.
  const signing = jwt();
  const scopedSigning = {
    ...signing,
    schema: {
      ...signing.schema,
      jwks: { ...signing.schema.jwks, ...model("jwks") },
    },
  };
  const engineOptions = {
    baseURL: resource.origin,
    basePath,
    secret: options.secret,
    // Better Auth's database union references optional Bun/Workers driver types.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    database: options.database,
    trustedOrigins: [resource.origin],
    logger: { disabled: true },
    disabledPaths: ["/token", ...(bridge.disabledPaths ?? [])],
    user: model("user"),
    account: {
      ...model("account"),
      accountLinking: { enabled: false },
      storeAccountCookie: false,
      encryptOAuthTokens: true,
    },
    session: {
      ...model("session"),
      expiresIn: sessionExpiresIn,
      updateAge: sessionExpiresIn,
      cookieCache: { enabled: false },
    },
    verification: model("verification"),
    rateLimit: {
      ...model("rateLimit"),
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
    },
    advanced: {
      cookiePrefix: `mcp-${id}`,
      ipAddress: { ipAddressHeaders: options.ipAddressHeaders ?? [] },
    },
    plugins: [
      scopedSigning,
      bridge.plugin,
      mcp({
        resource: resource.href,
        loginPage: loginPath,
        consentPage: consentPath,
        scopes,
        grantTypes: ["authorization_code", "refresh_token"],
        accessTokenExpiresIn,
        refreshTokenExpiresIn: sessionExpiresIn,
        refreshTokenReuseInterval: 0,
        allowDynamicClientRegistration:
          options.allowDynamicClientRegistration ?? false,
        allowUnauthenticatedClientRegistration:
          options.allowDynamicClientRegistration ?? false,
        clientRegistrationRequirePKCE: true,
        clientRegistrationAllowedResources: [resource.href],
        resources: [
          { identifier: resource.href, accessTokenTtl: accessTokenExpiresIn },
        ],
        resourceSeedMode: "merge",
        extensions: [bridge.extension],
        schema: {
          oauthClient: model("oauthClient"),
          oauthResource: model("oauthResource"),
          oauthClientResource: model("oauthClientResource"),
          oauthRefreshToken: model("oauthRefreshToken"),
          oauthAccessToken: model("oauthAccessToken"),
          oauthConsent: model("oauthConsent"),
          oauthClientAssertion: model("oauthClientAssertion"),
        },
      }) as ReturnType<typeof mcp> & BetterAuthPlugin,
      cimd({
        fetchClientMetadataResource: options.fetchClientMetadataResource,
        metadataProfile: "mcp-2026-07-28",
      }),
    ],
  } satisfies BetterAuthOptions;
  // Reject an engine upgrade that adds an unscoped persistence model.
  for (const table of Object.values(getAuthTables(engineOptions))) {
    if (!table.modelName.startsWith(prefix))
      throw new TypeError(
        "Native MCP engine contains an unscoped database model"
      );
  }
  const auth = betterAuth(engineOptions);
  return {
    basePath,
    loginPath,
    consentPath,
    async getMigrations() {
      const { getMigrations } = await import("better-auth/db/migration");
      const migration = await getMigrations(auth.options);
      return {
        ...migration,
        async runMigrations() {
          await migration.runMigrations();
          const keys = await auth.handler(
            new Request(new URL(`${basePath}/jwks`, resource.origin))
          );
          if (!keys.ok)
            throw new Error("Could not initialize MCP signing keys");
          await keys.body?.cancel();
        },
      };
    },
    async connect() {
      const context = await auth.$context;
      const keys = await context.adapter.findMany<{ expiresAt?: Date | null }>({
        model: "jwks",
        select: ["id", "expiresAt"],
      });
      if (
        !keys.some(
          (key) => !key.expiresAt || key.expiresAt.getTime() > Date.now()
        )
      ) {
        throw new Error("Run the native MCP auth migrations before connecting");
      }
      const integration = await betterAuthMcp({
        auth,
        resource,
        ...(options.requiredScopes !== undefined && {
          requiredScopes: options.requiredScopes,
        }),
        ...(options.runTokenOperation !== undefined && {
          runTokenOperation: options.runTokenOperation,
        }),
        checkSession: bridge.checkSession,
        mapAuthInfo: bridge.mapAuthInfo,
      });
      return {
        requestAuth: integration.requestAuth,
        handle(request) {
          // A path-specific engine must not capture another app's root discovery.
          if (
            new URL(request.url).pathname ===
              "/.well-known/oauth-protected-resource" &&
            resource.pathname !== "/"
          )
            return Promise.resolve(undefined);
          return integration.handle(request);
        },
      };
    },
  };
}
