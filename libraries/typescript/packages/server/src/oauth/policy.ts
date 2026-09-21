import type { ToolDefinition, ToolSecurityScheme } from "../tools.js";

/** @internal Key under which security schemes are mirrored into tool `_meta`. */
export const SECURITY_SCHEMES_META_KEY = "securitySchemes" as const;

/** @internal Authentication policy resolved for one registered tool. */
export interface ToolAuthPolicy {
  /**
   * `public`: anonymous calls run. `optional`: anonymous calls run and a
   * verified identity is exposed when supplied. `protected`: a verified
   * token carrying every scope in {@link ToolAuthPolicy.scopes} is required.
   */
  access: "public" | "optional" | "protected";
  /**
   * Provider baseline scopes unioned with the tool's `oauth2` scopes. For
   * `protected` tools these are enforced; for `optional` tools they are only
   * advertised, so the callback must check `ctx.auth.scopes` itself.
   */
  scopes: string[];
  /**
   * Schemes emitted on `tools/list`, or `undefined` when nothing should be
   * advertised (no declaration on a server without mixed auth).
   */
  wire: ToolSecurityScheme[] | undefined;
  /** Author-supplied text for authentication refusals. */
  message: string | undefined;
}

/** @internal Server-level facts the policy resolver needs. */
export interface ToolAuthPolicyOptions {
  /** Whether an OAuth provider is configured. */
  hasOAuth: boolean;
  /** Whether `allowAnonymous` is enabled. */
  allowAnonymous: boolean;
  /** Provider `requiredScopes`, enforced on every protected call. */
  baselineScopes: readonly string[];
}

type SchemeShape = Pick<ToolDefinition, "name" | "securitySchemes"> & {
  authErrorMessage?: unknown;
  _meta?: Record<string, unknown> | undefined;
};

function fail(name: string, detail: string): never {
  throw new TypeError(`Tool "${name}": ${detail}`);
}

/**
 * Validate a tool's `securitySchemes`, `authErrorMessage`, and legacy
 * `_meta.securitySchemes` against the server's OAuth configuration.
 *
 * @throws TypeError On an empty or malformed scheme array, duplicate scheme
 * types, `oauth2` without a provider, `noauth` without `allowAnonymous`, an
 * empty effective scope set, a multi-line `authErrorMessage`, or a
 * `_meta.securitySchemes` entry that conflicts with (or, under
 * `allowAnonymous`, substitutes for) the top-level field.
 *
 * @internal
 */
export function assertToolSecuritySchemes(
  definition: SchemeShape,
  options: ToolAuthPolicyOptions
): void {
  const { name, securitySchemes } = definition;
  const legacyMeta = definition._meta?.[SECURITY_SCHEMES_META_KEY];

  if (securitySchemes !== undefined && legacyMeta !== undefined) {
    fail(
      name,
      "declares both securitySchemes and _meta.securitySchemes; " +
        "remove the _meta entry, it is derived from the top-level field"
    );
  }
  if (
    securitySchemes === undefined &&
    legacyMeta !== undefined &&
    options.allowAnonymous
  ) {
    fail(
      name,
      "sets _meta.securitySchemes, which is descriptive only. With " +
        "allowAnonymous, declare the enforced policy on the top-level " +
        "securitySchemes field instead"
    );
  }

  if (definition.authErrorMessage !== undefined) {
    const message = definition.authErrorMessage;
    if (
      typeof message !== "string" ||
      message.trim().length === 0 ||
      /[\r\n]/.test(message)
    ) {
      fail(name, "authErrorMessage must be a non-empty single-line string");
    }
  }

  if (securitySchemes === undefined) {
    return;
  }
  if (!Array.isArray(securitySchemes) || securitySchemes.length === 0) {
    fail(
      name,
      "securitySchemes must be a non-empty array; omit the field for the default policy"
    );
  }

  let sawNoAuth = false;
  let oauth2Scopes: string[] | undefined;
  for (const scheme of securitySchemes) {
    if (typeof scheme !== "object" || scheme === null) {
      fail(name, "each security scheme must be an object with a type");
    }
    switch (scheme.type) {
      case "noauth": {
        if (sawNoAuth) fail(name, "declares more than one noauth scheme");
        sawNoAuth = true;
        break;
      }
      case "oauth2": {
        if (oauth2Scopes !== undefined) {
          fail(
            name,
            "declares more than one oauth2 scheme; a WWW-Authenticate " +
              "challenge can only advertise one scope set"
          );
        }
        if (
          !Array.isArray(scheme.scopes) ||
          !scheme.scopes.every(
            (scope) => typeof scope === "string" && scope.trim().length > 0
          )
        ) {
          fail(name, "oauth2 scopes must be an array of non-empty strings");
        }
        oauth2Scopes = scheme.scopes;
        break;
      }
      default:
        fail(
          name,
          `unsupported security scheme type ${JSON.stringify(
            (scheme as { type?: unknown }).type
          )}; use "noauth" or "oauth2"`
        );
    }
  }

  if (oauth2Scopes !== undefined && !options.hasOAuth) {
    fail(
      name,
      "declares an oauth2 scheme but the server has no OAuth provider"
    );
  }
  if (sawNoAuth && options.hasOAuth && !options.allowAnonymous) {
    fail(
      name,
      "declares noauth but the server requires OAuth on every request; " +
        "set allowAnonymous: true on the server to serve public tools"
    );
  }
  if (
    oauth2Scopes !== undefined &&
    oauth2Scopes.length === 0 &&
    options.baselineScopes.length === 0
  ) {
    fail(
      name,
      "oauth2 scheme has no scopes and the provider declares no " +
        "requiredScopes; declare at least one scope so clients can request it"
    );
  }
}

/**
 * Resolve the enforced policy and advertised schemes for a tool.
 *
 * Call {@link assertToolSecuritySchemes} first; this function assumes a valid
 * declaration.
 *
 * @internal
 */
export function resolveToolAuthPolicy(
  definition: SchemeShape,
  options: ToolAuthPolicyOptions
): ToolAuthPolicy {
  const message =
    typeof definition.authErrorMessage === "string"
      ? definition.authErrorMessage
      : undefined;
  const declared = definition.securitySchemes;

  if (declared === undefined) {
    const scopes = [...options.baselineScopes];
    return {
      access: "protected",
      scopes,
      wire:
        options.hasOAuth && options.allowAnonymous
          ? [{ type: "oauth2", scopes }]
          : undefined,
      message,
    };
  }

  const noAuth = declared.some((scheme) => scheme.type === "noauth");
  const oauth2 = declared.find((scheme) => scheme.type === "oauth2");
  const scopes =
    oauth2 === undefined
      ? []
      : unionScopes(options.baselineScopes, oauth2.scopes);

  const wire: ToolSecurityScheme[] = [];
  if (noAuth) wire.push({ type: "noauth" });
  if (oauth2 !== undefined) wire.push({ type: "oauth2", scopes: [...scopes] });

  return {
    access: !noAuth
      ? "protected"
      : oauth2 === undefined
        ? "public"
        : "optional",
    scopes,
    wire,
    message,
  };
}

function unionScopes(
  baseline: readonly string[],
  extra: readonly string[]
): string[] {
  return [...new Set([...baseline, ...extra])];
}
