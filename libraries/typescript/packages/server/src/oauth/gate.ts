import {
  PROTOCOL_VERSION_META_KEY,
  OAuthError,
  OAuthErrorCode,
  bearerAuthChallengeResponse,
  verifyBearerToken,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

import type { AuthChallengeFormat } from "../config.js";
import { getRequestBag, type FetchMiddleware } from "../fetch-app.js";
import type { ToolAuthPolicy } from "./policy.js";

/** @internal `_meta` key ChatGPT reads for a tool-result auth challenge. */
export const WWW_AUTHENTICATE_META_KEY = "mcp/www_authenticate" as const;

/** @internal Options for {@link createOAuthGate}. */
export interface OAuthGateOptions {
  /** Verifier bound to the canonical MCP resource. */
  verifier: OAuthTokenVerifier;
  /** RFC 9728 metadata URL advertised in every challenge. */
  resourceMetadataUrl: string;
  /** Provider `requiredScopes`, enforced on every protected request. */
  baselineScopes: readonly string[];
  /** Whether anonymous discovery and public tools are served. */
  allowAnonymous: boolean;
  /** Representation of `tools/call` failures. */
  challenge: AuthChallengeFormat;
  /** Policy for a registered tool, or `undefined` for an unknown name. */
  toolPolicy: (name: string) => ToolAuthPolicy | undefined;
  /** Whether a resource URI may be read anonymously. */
  isPublicResource: (uri: string) => boolean;
}

/** Reason an authenticated operation was refused. */
type RefusalReason = "missing_token" | "invalid_token" | "insufficient_scope";

/** Methods an anonymous caller may issue on a mixed-auth server. */
const ANONYMOUS_METHODS = new Set([
  "initialize",
  "ping",
  "tools/list",
  "resources/list",
  "resources/templates/list",
  "prompts/list",
]);

const CHATGPT_USER_AGENT = /chatgpt|openai/i;

interface ParsedOperation {
  method: string;
  id: string | number | undefined;
  params: Record<string, unknown> | undefined;
}

interface Requirement {
  required: boolean;
  scopes: readonly string[];
  message: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOperation(body: unknown): ParsedOperation | undefined {
  if (!isRecord(body) || typeof body["method"] !== "string") return undefined;
  const id = body["id"];
  const params = body["params"];
  return {
    method: body["method"],
    id: typeof id === "string" || typeof id === "number" ? id : undefined,
    params: isRecord(params) ? params : undefined,
  };
}

function isModernEnvelope(operation: ParsedOperation): boolean {
  const meta = operation.params?.["_meta"];
  return isRecord(meta) && meta[PROTOCOL_VERSION_META_KEY] !== undefined;
}

function defaultMessage(
  reason: RefusalReason,
  scopes: readonly string[]
): string {
  if (reason === "missing_token") {
    return "Authentication is required for this request.";
  }
  if (reason === "invalid_token") {
    return "The access token is invalid or expired.";
  }
  return scopes.length > 0
    ? `Additional permissions are required: ${scopes.join(" ")}.`
    : "Additional permissions are required.";
}

/**
 * Build the bearer gate that fronts the MCP endpoint.
 *
 * Verifies any supplied token first (an invalid or expired token is always
 * refused), then decides from the JSON-RPC method and the tool policy
 * whether the operation may proceed anonymously. Protected operations need a
 * token whose scopes cover the provider baseline plus the tool's `oauth2`
 * scopes. Verified identity is stashed on the request bag for the mount.
 *
 * Without `allowAnonymous`, every request is protected with the baseline
 * scopes, and tool-level `oauth2` scopes still add to that requirement.
 *
 * @internal
 */
export function createOAuthGate(options: OAuthGateOptions): FetchMiddleware {
  const {
    verifier,
    resourceMetadataUrl,
    baselineScopes,
    allowAnonymous,
    challenge,
    toolPolicy,
    isPublicResource,
  } = options;

  const requirementFor = (
    operation: ParsedOperation | undefined
  ): Requirement => {
    const baseline: Requirement = {
      required: true,
      scopes: baselineScopes,
      message: undefined,
    };
    if (operation === undefined) {
      // Notifications, malformed bodies, and non-JSON-RPC requests: the SDK
      // answers these itself. Anonymous servers let them through.
      return { ...baseline, required: !allowAnonymous };
    }
    if (operation.method === "tools/call") {
      const name = operation.params?.["name"];
      const policy = typeof name === "string" ? toolPolicy(name) : undefined;
      if (policy === undefined) return baseline;
      if (!allowAnonymous) {
        return {
          required: true,
          scopes: policy.scopes,
          message: policy.message,
        };
      }
      return {
        required: policy.access === "protected",
        scopes: policy.scopes,
        message: policy.message,
      };
    }
    if (!allowAnonymous) return baseline;
    if (ANONYMOUS_METHODS.has(operation.method)) {
      return { ...baseline, required: false };
    }
    if (operation.method === "resources/read") {
      const uri = operation.params?.["uri"];
      if (typeof uri === "string" && isPublicResource(uri)) {
        return { ...baseline, required: false };
      }
    }
    if (
      operation.id === undefined &&
      operation.method.startsWith("notifications/")
    ) {
      return { ...baseline, required: false };
    }
    return baseline;
  };

  const refuse = (
    request: Request,
    operation: ParsedOperation | undefined,
    reason: RefusalReason,
    scopes: readonly string[],
    message: string | undefined,
    cause?: OAuthError
  ): Response => {
    const code =
      reason === "insufficient_scope"
        ? OAuthErrorCode.InsufficientScope
        : OAuthErrorCode.InvalidToken;
    const text =
      message ??
      (reason === "invalid_token" && cause !== undefined
        ? cause.message
        : defaultMessage(reason, scopes));
    const http = bearerAuthChallengeResponse(new OAuthError(code, text), {
      requiredScopes: [...scopes],
      resourceMetadataUrl,
    });

    if (
      operation === undefined ||
      operation.method !== "tools/call" ||
      operation.id === undefined ||
      !useToolResultChallenge(request)
    ) {
      return http;
    }

    const header = http.headers.get("WWW-Authenticate");
    return Response.json({
      jsonrpc: "2.0",
      id: operation.id,
      result: {
        ...(isModernEnvelope(operation) && { resultType: "complete" }),
        content: [{ type: "text", text }],
        isError: true,
        _meta: {
          [WWW_AUTHENTICATE_META_KEY]: header === null ? [] : [header],
        },
      },
    });
  };

  const useToolResultChallenge = (request: Request): boolean => {
    if (challenge === "tool-result") return true;
    if (challenge === "http") return false;
    return CHATGPT_USER_AGENT.test(request.headers.get("user-agent") ?? "");
  };

  return async (request, next) => {
    const bag = getRequestBag(request);
    let body = bag.parsedBody;
    if (body === undefined && request.method.toUpperCase() === "POST") {
      try {
        body = await request.clone().json();
      } catch {
        // Leave the SDK to report the malformed body.
      }
    }
    const operation = parseOperation(body);
    const requirement = requirementFor(operation);

    let authInfo: AuthInfo | undefined;
    const authorization = request.headers.get("authorization");
    if (authorization !== null || requirement.required) {
      try {
        authInfo = await verifyBearerToken(authorization, { verifier });
      } catch (error) {
        if (!(error instanceof OAuthError)) {
          return bearerAuthChallengeResponse(error, { resourceMetadataUrl });
        }
        if (
          error.code === OAuthErrorCode.InvalidToken &&
          authorization === null
        ) {
          return refuse(
            request,
            operation,
            "missing_token",
            requirement.scopes,
            requirement.message
          );
        }
        return refuse(
          request,
          operation,
          "invalid_token",
          requirement.scopes,
          requirement.message,
          error
        );
      }
    }

    if (requirement.required && authInfo !== undefined) {
      const granted = new Set(authInfo.scopes);
      if (!requirement.scopes.every((scope) => granted.has(scope))) {
        return refuse(
          request,
          operation,
          "insufficient_scope",
          requirement.scopes,
          requirement.message
        );
      }
    }

    if (authInfo !== undefined) {
      bag.authInfo = authInfo;
    }
    return next();
  };
}
