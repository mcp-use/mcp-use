import {
  OAuthError,
  OAuthErrorCode,
  bearerAuthChallengeResponse,
} from "@modelcontextprotocol/server";

/** @internal `_meta` key ChatGPT reads for a tool-result auth challenge. */
export const WWW_AUTHENTICATE_META_KEY = "mcp/www_authenticate" as const;

/** @internal User agents that need the tool-result challenge format. */
const TOOL_RESULT_CHALLENGE_USER_AGENT = /chatgpt|openai/i;

/** @internal Why a request was refused. */
export type AuthChallengeReason =
  | "missing_token"
  | "invalid_token"
  | "insufficient_scope";

/**
 * @internal A sign-in challenge, independent of how it reaches the client.
 *
 * Every refusal is built here, whether the gate sends it as HTTP 401/403 or
 * as ChatGPT's `isError` tool result, so both formats always agree.
 */
export interface AuthChallenge {
  reason: AuthChallengeReason;
  /** Human-readable `error_description`, also the tool-result text. */
  description: string;
  /** The full scope set the request needs, advertised as `scope`. */
  scopes: readonly string[];
  /** RFC 9728 metadata URL advertised as `resource_metadata`. */
  resourceMetadataUrl: string;
}

/** @internal Inputs for {@link createAuthChallenge}. */
export interface AuthChallengeOptions {
  reason: AuthChallengeReason;
  /**
   * The full scope set the request needs: the provider's `requiredScopes`
   * plus the item's scopes, not only the missing ones. Clients request this
   * set on sign-in or step-up.
   */
  scopes: readonly string[];
  /** RFC 9728 metadata URL advertised as `resource_metadata`. */
  resourceMetadataUrl: string;
  /** Scopes the presented token lacks, named in the description. */
  missingScopes?: readonly string[];
  /** Description override, such as the verifier's reason for `invalid_token`. */
  description?: string;
}

function defaultDescription(
  reason: AuthChallengeReason,
  missingScopes: readonly string[]
): string {
  if (reason === "missing_token") {
    return "Authentication is required for this request.";
  }
  if (reason === "invalid_token") {
    return "The access token is invalid or expired.";
  }
  return missingScopes.length > 0
    ? `Additional permissions are required: ${missingScopes.join(" ")}.`
    : "Additional permissions are required.";
}

/**
 * Build a sign-in challenge.
 *
 * @internal
 */
export function createAuthChallenge(
  options: AuthChallengeOptions
): AuthChallenge {
  return {
    reason: options.reason,
    description:
      options.description ??
      defaultDescription(options.reason, options.missingScopes ?? []),
    scopes: [...options.scopes],
    resourceMetadataUrl: options.resourceMetadataUrl,
  };
}

/**
 * The spec's transport challenge: `401` for a missing or invalid token,
 * `403` for missing scopes, with an RFC 6750 `WWW-Authenticate` header
 * carrying `error`, `error_description`, `scope`, and `resource_metadata`.
 * Claude and other spec clients start or step up OAuth from it.
 *
 * @internal
 */
export function authChallengeHttpResponse(challenge: AuthChallenge): Response {
  return bearerAuthChallengeResponse(
    new OAuthError(
      challenge.reason === "insufficient_scope"
        ? OAuthErrorCode.InsufficientScope
        : OAuthErrorCode.InvalidToken,
      challenge.description
    ),
    {
      requiredScopes: [...challenge.scopes],
      resourceMetadataUrl: challenge.resourceMetadataUrl,
    }
  );
}

/**
 * ChatGPT's in-band challenge: an `isError` tool result whose
 * `_meta["mcp/www_authenticate"]` carries the same header value.
 *
 * @internal
 */
export function authChallengeToolResult(challenge: AuthChallenge): {
  content: [{ type: "text"; text: string }];
  isError: true;
  _meta: { [WWW_AUTHENTICATE_META_KEY]: string[] };
} {
  const header =
    authChallengeHttpResponse(challenge).headers.get("WWW-Authenticate");
  return {
    content: [{ type: "text", text: challenge.description }],
    isError: true,
    _meta: { [WWW_AUTHENTICATE_META_KEY]: header === null ? [] : [header] },
  };
}

/**
 * Whether a refused `tools/call` should use the tool-result format. Only
 * ChatGPT needs it; a missing User-Agent gets HTTP.
 *
 * @internal
 */
export function prefersToolResultChallenge(request: Request): boolean {
  return TOOL_RESULT_CHALLENGE_USER_AGENT.test(
    request.headers.get("user-agent") ?? ""
  );
}
