import type { ToolSecurityScheme } from "../tools.js";

/** @internal Key under which security schemes are mirrored into tool `_meta`. */
export const SECURITY_SCHEMES_META_KEY = "securitySchemes" as const;

/** @internal Server-level facts the scheme resolver needs. */
export interface SecuritySchemeOptions {
  /** Whether an OAuth provider is configured. */
  hasOAuth: boolean;
  /** Whether `mixedAuth` is enabled. */
  mixedAuth: boolean;
  /** Provider `requiredScopes`, enforced on every tool that needs sign-in. */
  baselineScopes: readonly string[];
}

const SCHEME_SHAPE =
  'each security scheme must be { type: "noauth" } or ' +
  '{ type: "oauth2", scopes: string[] }';

/**
 * An RFC 6749 section 3.3 scope token: printable ASCII except space, `"`,
 * and `\`. Scopes are space-separated in challenges and token claims, so a
 * value with whitespace would split into several scopes and never match.
 */
const SCOPE_TOKEN = /^[\x21\x23-\x5B\x5D-\x7E]+$/;

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
 * Validate a tool's `securitySchemes` against the server configuration and
 * resolve the schemes the gate enforces and `tools/list` advertises.
 *
 * The result lists `noauth` first, and its `oauth2` scopes include the
 * provider's `requiredScopes`. An omitted declaration resolves to sign-in
 * with the provider's `requiredScopes`.
 *
 * @throws TypeError On an empty or malformed array, a duplicate scheme type,
 * a scope that is not a single RFC 6749 scope token,
 * `noauth` without `mixedAuth`, `oauth2` without an OAuth provider, or an
 * `oauth2` scheme whose scopes are empty when the provider has no
 * `requiredScopes`.
 *
 * @internal
 */
export function resolveSecuritySchemes(
  name: string,
  declared: unknown,
  options: SecuritySchemeOptions
): ToolSecurityScheme[] {
  const fail = (detail: string): never => {
    throw new TypeError(`Tool "${name}": ${detail}`);
  };

  if (declared === undefined) {
    return [{ type: "oauth2", scopes: [...options.baselineScopes] }];
  }
  if (!Array.isArray(declared) || declared.length === 0) {
    fail(
      "securitySchemes must be a non-empty array; omit it to require " +
        "sign-in with the provider's requiredScopes"
    );
  }

  let noAuth = false;
  let oauth2Scopes: readonly string[] | undefined;
  for (const scheme of declared as unknown[]) {
    if (!isRecord(scheme)) fail(SCHEME_SHAPE);
    const { type } = scheme as Record<string, unknown>;
    const allowed = type === "oauth2" ? ["type", "scopes"] : ["type"];
    for (const key of Object.keys(scheme as object)) {
      if (!allowed.includes(key)) {
        fail(
          `unknown security scheme field ${JSON.stringify(key)}; ${SCHEME_SHAPE}`
        );
      }
    }
    if (type === "noauth") {
      if (noAuth) fail("declares more than one noauth scheme");
      noAuth = true;
    } else if (type === "oauth2") {
      if (oauth2Scopes !== undefined) {
        fail(
          "declares more than one oauth2 scheme; a sign-in challenge can " +
            "only ask for one scope set"
        );
      }
      const { scopes } = scheme as Record<string, unknown>;
      if (!Array.isArray(scopes)) {
        fail("oauth2 scopes must be an array of scope strings");
      }
      for (const scope of scopes as unknown[]) {
        if (typeof scope !== "string" || !SCOPE_TOKEN.test(scope)) {
          fail(
            `invalid oauth2 scope ${JSON.stringify(scope)}; each scope must ` +
              'be one non-empty token without whitespace, ", or \\'
          );
        }
      }
      oauth2Scopes = scopes as readonly string[];
    } else {
      fail(
        `unsupported security scheme type ${JSON.stringify(type)}; ` +
          'use "noauth" or "oauth2"'
      );
    }
  }

  if (noAuth && !options.mixedAuth) {
    fail(
      options.hasOAuth
        ? "noauth requires mixedAuth: true on the server. Without it, every " +
            "request needs a token, so signed-out callers could never use it"
        : "noauth requires an OAuth provider with mixedAuth: true. A server " +
            "without OAuth serves every tool signed out, so remove " +
            "securitySchemes"
    );
  }
  if (oauth2Scopes !== undefined && !options.hasOAuth) {
    fail("oauth2 requires an OAuth provider to verify tokens");
  }
  if (
    oauth2Scopes !== undefined &&
    oauth2Scopes.length === 0 &&
    options.baselineScopes.length === 0
  ) {
    fail(
      "oauth2 scopes are empty and the OAuth provider has no " +
        "requiredScopes. ChatGPT ignores an oauth2 scheme without scopes " +
        "and would never offer sign-in; list at least one scope"
    );
  }

  const resolved: ToolSecurityScheme[] = [];
  if (noAuth) resolved.push({ type: "noauth" });
  if (oauth2Scopes !== undefined) {
    resolved.push({
      type: "oauth2",
      scopes: unionScopes(options.baselineScopes, oauth2Scopes),
    });
  }
  return resolved;
}

/**
 * Whether resolved schemes require sign-in: they do unless one is `noauth`.
 *
 * @internal
 */
export function requiresSignIn(
  schemes: readonly ToolSecurityScheme[]
): boolean {
  return !schemes.some((scheme) => scheme.type === "noauth");
}

/**
 * The scopes of the resolved `oauth2` scheme: enforced when the tool
 * requires sign-in, only advertised when it also accepts `noauth`.
 *
 * @internal
 */
export function schemeScopes(
  schemes: readonly ToolSecurityScheme[]
): readonly string[] {
  for (const scheme of schemes) {
    if (scheme.type === "oauth2") return scheme.scopes;
  }
  return [];
}

/**
 * Warning for hand-written `_meta.securitySchemes`, which mcp-use passes
 * through for backward compatibility but never enforces. `undefined` when
 * there is nothing to warn about.
 *
 * @internal
 */
export function handWrittenSecuritySchemesWarning(
  name: string,
  definition: {
    securitySchemes?: unknown;
    _meta?: Record<string, unknown> | undefined;
  },
  options: SecuritySchemeOptions
): string | undefined {
  const handWritten = definition._meta?.[SECURITY_SCHEMES_META_KEY];
  if (handWritten === undefined) return undefined;
  if (definition.securitySchemes !== undefined) {
    return JSON.stringify(handWritten) ===
      JSON.stringify(definition.securitySchemes)
      ? undefined
      : `[mcp-use] Tool "${name}": _meta.securitySchemes is replaced by the ` +
          "top-level securitySchemes. Remove the _meta entry.";
  }
  if (options.mixedAuth) {
    return (
      `[mcp-use] Tool "${name}": _meta.securitySchemes is advertised but ` +
      "not enforced, so the tool requires sign-in. Move it to the top-level " +
      "securitySchemes field."
    );
  }
  return undefined;
}
