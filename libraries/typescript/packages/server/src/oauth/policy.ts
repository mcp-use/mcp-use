import type { MetaObject } from "@modelcontextprotocol/server";

/** @internal Key under which security schemes are mirrored into tool `_meta`. */
export const SECURITY_SCHEMES_META_KEY = "securitySchemes" as const;

/**
 * @internal One entry of the `securitySchemes` array ChatGPT reads on
 * `tools/list`. Generated from `auth`; never written by developers.
 */
export type SecurityScheme =
  | { type: "noauth" }
  | { type: "oauth2"; scopes: string[] };

/**
 * @internal Access rule resolved from one item's `auth` declaration.
 *
 * `public` and `optional` items run for signed-out callers. `sign-in` items
 * need a verified token carrying every scope in {@link AuthPolicy.scopes}.
 */
export interface AuthPolicy {
  access: "public" | "optional" | "sign-in";
  /**
   * The provider's `requiredScopes` unioned with the declared scopes.
   * Enforced for `sign-in`, only advertised for `optional`, empty for
   * `public`.
   */
  scopes: readonly string[];
  /** Whether the item declared `auth` itself. */
  declared: boolean;
}

/** @internal Server-level facts the policy resolver needs. */
export interface AuthPolicyOptions {
  /** Whether an OAuth provider is configured. */
  hasOAuth: boolean;
  /** Whether `mixedAuth` is enabled. */
  mixedAuth: boolean;
  /** Provider `requiredScopes`, enforced on every sign-in item. */
  baselineScopes: readonly string[];
}

/** @internal Kind of item an `auth` declaration belongs to, for errors. */
export type AuthItemKind = "Tool" | "Resource" | "Resource template" | "Prompt";

const AUTH_SHAPE =
  'auth must be "public", "optional", or { scopes: string[]; optional?: boolean }';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unionScopes(
  baseline: readonly string[],
  extra: readonly string[]
): string[] {
  return [...new Set([...baseline, ...extra])];
}

/**
 * Validate an item's `auth` declaration against the server configuration and
 * resolve the policy the gate enforces.
 *
 * @throws TypeError On a malformed value, `"public"` or `"optional"` without
 * `mixedAuth`, `scopes` without an OAuth provider, or an empty `scopes` list
 * when the provider has no `requiredScopes`.
 *
 * @internal
 */
export function resolveAuthPolicy(
  kind: AuthItemKind,
  name: string,
  auth: unknown,
  options: AuthPolicyOptions
): AuthPolicy {
  const fail = (detail: string): never => {
    throw new TypeError(`${kind} "${name}": ${detail}`);
  };
  const requireMixedAuth = (label: string): void => {
    if (options.mixedAuth) return;
    fail(
      options.hasOAuth
        ? `${label} requires mixedAuth: true on the server. Without it, every ` +
            "request needs a token, so signed-out callers could never use it"
        : `${label} requires an OAuth provider with mixedAuth: true. A server ` +
            "without OAuth serves everything signed out, so remove auth"
    );
  };

  if (auth === undefined) {
    return {
      access: "sign-in",
      scopes: [...options.baselineScopes],
      declared: false,
    };
  }
  if (auth === "public") {
    requireMixedAuth('auth "public"');
    return { access: "public", scopes: [], declared: true };
  }
  if (auth === "optional") {
    requireMixedAuth('auth "optional"');
    return {
      access: "optional",
      scopes: [...options.baselineScopes],
      declared: true,
    };
  }
  if (!isRecord(auth)) return fail(AUTH_SHAPE);

  for (const key of Object.keys(auth)) {
    if (key !== "scopes" && key !== "optional") {
      fail(`unknown auth field ${JSON.stringify(key)}; ${AUTH_SHAPE}`);
    }
  }
  const { scopes, optional } = auth;
  if (
    !Array.isArray(scopes) ||
    !scopes.every(
      (scope) => typeof scope === "string" && scope.trim().length > 0
    )
  ) {
    fail("auth.scopes must be an array of non-empty strings");
  }
  if (optional !== undefined && typeof optional !== "boolean") {
    fail("auth.optional must be a boolean");
  }
  if (optional === true) {
    requireMixedAuth("auth { optional: true }");
  }
  if (!options.hasOAuth) {
    fail("auth.scopes requires an OAuth provider to verify them");
  }
  const declaredScopes = scopes as readonly string[];
  if (declaredScopes.length === 0 && options.baselineScopes.length === 0) {
    fail(
      "auth.scopes is empty and the OAuth provider has no requiredScopes. " +
        "ChatGPT ignores an oauth2 scheme without scopes and would never " +
        "offer sign-in; list at least one scope or omit auth"
    );
  }
  return {
    access: optional === true ? "optional" : "sign-in",
    scopes: unionScopes(options.baselineScopes, declaredScopes),
    declared: true,
  };
}

/**
 * Reject hand-written `_meta.securitySchemes` where mcp-use generates the
 * field: next to `auth`, or anywhere on a `mixedAuth` server.
 *
 * @throws TypeError When the tool sets `_meta.securitySchemes` and either
 * declares `auth` or is registered on a `mixedAuth` server.
 *
 * @internal
 */
export function assertHandWrittenSecuritySchemes(
  name: string,
  definition: { auth?: unknown; _meta?: MetaObject | undefined },
  options: AuthPolicyOptions
): void {
  if (definition._meta?.[SECURITY_SCHEMES_META_KEY] === undefined) return;
  if (definition.auth !== undefined) {
    throw new TypeError(
      `Tool "${name}": _meta.securitySchemes is generated from auth. ` +
        "Remove the _meta entry"
    );
  }
  if (options.mixedAuth) {
    throw new TypeError(
      `Tool "${name}": sets _meta.securitySchemes on a mixedAuth server. ` +
        'Declare auth ("public", "optional", or { scopes }) instead; ' +
        "without it the tool requires sign-in"
    );
  }
}

const ACCESS_RANK: Record<AuthPolicy["access"], number> = {
  public: 0,
  optional: 1,
  "sign-in": 2,
};

/**
 * The stricter of two policies, for a request that several items could
 * serve. Equal access merges the scopes.
 *
 * @internal
 */
export function stricterPolicy(a: AuthPolicy, b: AuthPolicy): AuthPolicy {
  if (ACCESS_RANK[a.access] !== ACCESS_RANK[b.access]) {
    return ACCESS_RANK[a.access] > ACCESS_RANK[b.access] ? a : b;
  }
  return {
    access: a.access,
    scopes: unionScopes(a.scopes, b.scopes),
    declared: a.declared || b.declared,
  };
}

/**
 * The `securitySchemes` advertised for a tool with this policy.
 *
 * @internal
 */
export function securitySchemesFor(policy: AuthPolicy): SecurityScheme[] {
  if (policy.access === "public") return [{ type: "noauth" }];
  const oauth2: SecurityScheme = { type: "oauth2", scopes: [...policy.scopes] };
  return policy.access === "optional" ? [{ type: "noauth" }, oauth2] : [oauth2];
}
