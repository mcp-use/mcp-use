import {
  PROTOCOL_VERSION_META_KEY,
  OAuthError,
  OAuthErrorCode,
  bearerAuthChallengeResponse,
  verifyBearerToken,
  type AuthInfo,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

import { getRequestBag, type FetchMiddleware } from "../fetch-app.js";
import {
  authChallengeHttpResponse,
  authChallengeToolResult,
  createAuthChallenge,
  prefersToolResultChallenge,
  type AuthChallengeReason,
} from "./challenge.js";
import type { AuthPolicy } from "./policy.js";

/** @internal Options for {@link createOAuthGate}. */
export interface OAuthGateOptions {
  /** Verifier bound to the canonical MCP resource. */
  verifier: OAuthTokenVerifier;
  /** RFC 9728 metadata URL advertised in every challenge. */
  resourceMetadataUrl: string;
  /** Provider `requiredScopes`, enforced on every sign-in request. */
  baselineScopes: readonly string[];
  /** Whether signed-out callers may connect, list, and use public items. */
  mixedAuth: boolean;
  /** Policy for a tool name, or `undefined` for an unknown tool. */
  toolPolicy: (name: string) => AuthPolicy | undefined;
  /** Policy for a resource URI as `resources/read` resolves it. */
  resourcePolicy: (uri: string) => AuthPolicy | undefined;
  /** Policy for a `completion/complete` `ref/resource` URI. */
  completionResourcePolicy: (uri: string) => AuthPolicy | undefined;
  /** Policy for a prompt name, or `undefined` for an unknown prompt. */
  promptPolicy: (name: string) => AuthPolicy | undefined;
}

/**
 * Methods a signed-out caller may issue on a `mixedAuth` server regardless of
 * any item's `auth`: discovery (`initialize` on 2025-era protocols,
 * `server/discover` on 2026-07-28), `ping`, the list methods, and the
 * 2025-era `logging/setLevel`, which reads no data. Refusing any of these
 * would make hosts demand sign-in at connection time. Every method not
 * listed here and not tied to an item requires sign-in.
 */
const SIGNED_OUT_METHODS = new Set([
  "initialize",
  "server/discover",
  "ping",
  "tools/list",
  "resources/list",
  "resources/templates/list",
  "prompts/list",
  "logging/setLevel",
]);

interface ParsedMessage {
  method: string;
  id: string | number | undefined;
  params: Record<string, unknown> | undefined;
}

interface Requirement {
  /** Whether the request needs a verified token. */
  required: boolean;
  /** Every scope the token must carry when `required`. */
  scopes: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMessage(body: unknown): ParsedMessage | undefined {
  if (!isRecord(body) || typeof body["method"] !== "string") return undefined;
  const id = body["id"];
  const params = body["params"];
  return {
    method: body["method"],
    id: typeof id === "string" || typeof id === "number" ? id : undefined,
    params: isRecord(params) ? params : undefined,
  };
}

function isModernEnvelope(message: ParsedMessage): boolean {
  const meta = message.params?.["_meta"];
  return isRecord(meta) && meta[PROTOCOL_VERSION_META_KEY] !== undefined;
}

function stringParam(
  params: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = params?.[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Build the bearer gate that fronts the MCP endpoint.
 *
 * A token that is sent is always verified first; an invalid or expired one is
 * refused with `401` on every request. Then the JSON-RPC method and the
 * targeted item's policy decide whether the request needs sign-in, and which
 * scopes. Verified identity is stashed on the request bag for the mount.
 *
 * Without `mixedAuth`, every request needs a token with the provider's
 * `requiredScopes`, plus the scopes of the item it targets.
 *
 * @internal
 */
export function createOAuthGate(options: OAuthGateOptions): FetchMiddleware {
  const {
    verifier,
    resourceMetadataUrl,
    baselineScopes,
    mixedAuth,
    toolPolicy,
    resourcePolicy,
    completionResourcePolicy,
    promptPolicy,
  } = options;

  /**
   * Policies of the items a message targets, or `undefined` when its method
   * is not tied to items. A missing entry is an unknown item.
   */
  const itemPolicies = (
    message: ParsedMessage
  ): (AuthPolicy | undefined)[] | undefined => {
    const { params } = message;
    switch (message.method) {
      case "tools/call": {
        const name = stringParam(params, "name");
        return [name === undefined ? undefined : toolPolicy(name)];
      }
      case "prompts/get": {
        const name = stringParam(params, "name");
        return [name === undefined ? undefined : promptPolicy(name)];
      }
      case "resources/read":
      case "resources/subscribe":
      case "resources/unsubscribe": {
        const uri = stringParam(params, "uri");
        return [uri === undefined ? undefined : resourcePolicy(uri)];
      }
      case "completion/complete": {
        // Completers never see identity, so completing an item's arguments
        // follows that item's `auth`.
        const ref = params?.["ref"];
        if (!isRecord(ref)) return [undefined];
        if (ref["type"] === "ref/prompt") {
          const name = stringParam(ref, "name");
          return [name === undefined ? undefined : promptPolicy(name)];
        }
        if (ref["type"] === "ref/resource") {
          const uri = stringParam(ref, "uri");
          return [
            uri === undefined ? undefined : completionResourcePolicy(uri),
          ];
        }
        return [undefined];
      }
      case "subscriptions/listen": {
        // List-changed notifications reveal nothing the open list methods do
        // not; resource subscriptions follow each resource's `auth`.
        const filter = params?.["notifications"];
        const uris = isRecord(filter)
          ? filter["resourceSubscriptions"]
          : undefined;
        if (uris === undefined) return [];
        if (!Array.isArray(uris)) return [undefined];
        return uris.map((uri) =>
          typeof uri === "string" ? resourcePolicy(uri) : undefined
        );
      }
      default:
        return undefined;
    }
  };

  const requirementFor = (message: ParsedMessage | undefined): Requirement => {
    const scopes = new Set<string>();
    let required = !mixedAuth;
    const policies = message === undefined ? undefined : itemPolicies(message);

    if (policies !== undefined) {
      for (const policy of policies) {
        if (policy === undefined) {
          required = true;
        } else if (!mixedAuth || policy.access === "sign-in") {
          required = true;
          for (const scope of policy.scopes) scopes.add(scope);
        }
      }
    } else if (
      message !== undefined &&
      !SIGNED_OUT_METHODS.has(message.method) &&
      !(message.id === undefined && message.method.startsWith("notifications/"))
    ) {
      // Unknown methods default to sign-in. Non-JSON-RPC bodies (`message`
      // undefined) and notifications are answered by the SDK without
      // running any callback.
      required = true;
    }

    if (!required) return { required: false, scopes: [] };
    for (const scope of baselineScopes) scopes.add(scope);
    return { required: true, scopes: [...scopes] };
  };

  const requirementForBody = (body: unknown): Requirement => {
    if (!Array.isArray(body)) return requirementFor(parseMessage(body));
    // 2025-era JSON-RPC batches: the strictest element decides.
    const scopes = new Set<string>();
    let required = false;
    for (const element of body) {
      const requirement = requirementFor(parseMessage(element));
      if (!requirement.required) continue;
      required = true;
      for (const scope of requirement.scopes) scopes.add(scope);
    }
    return { required, scopes: [...scopes] };
  };

  const refuse = (
    request: Request,
    message: ParsedMessage | undefined,
    reason: AuthChallengeReason,
    requirement: Requirement,
    details: { missingScopes?: readonly string[]; description?: string } = {}
  ): Response => {
    const challenge = createAuthChallenge({
      reason,
      // A bad token on a public or optional item still hints the baseline,
      // so the client's refresh or re-authorization asks for it.
      scopes: requirement.required ? requirement.scopes : baselineScopes,
      resourceMetadataUrl,
      ...details,
    });
    if (
      message === undefined ||
      message.method !== "tools/call" ||
      message.id === undefined ||
      !prefersToolResultChallenge(request)
    ) {
      return authChallengeHttpResponse(challenge);
    }
    return Response.json({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        ...(isModernEnvelope(message) && { resultType: "complete" }),
        ...authChallengeToolResult(challenge),
      },
    });
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
    // Batches always get HTTP challenges.
    const message = Array.isArray(body) ? undefined : parseMessage(body);
    const requirement = requirementForBody(body);

    let authInfo: AuthInfo | undefined;
    const authorization = request.headers.get("authorization");
    if (authorization !== null || requirement.required) {
      try {
        authInfo = await verifyBearerToken(authorization, { verifier });
      } catch (error) {
        if (
          !(error instanceof OAuthError) ||
          (error.code !== OAuthErrorCode.InvalidToken &&
            error.code !== OAuthErrorCode.InsufficientScope)
        ) {
          // Verifier outages are server errors, not sign-in challenges.
          return bearerAuthChallengeResponse(error, { resourceMetadataUrl });
        }
        if (error.code === OAuthErrorCode.InsufficientScope) {
          return refuse(request, message, "insufficient_scope", requirement, {
            description: error.message,
          });
        }
        return authorization === null
          ? refuse(request, message, "missing_token", requirement)
          : refuse(request, message, "invalid_token", requirement, {
              description: error.message,
            });
      }
    }

    if (requirement.required && authInfo !== undefined) {
      const granted = new Set(authInfo.scopes);
      const missingScopes = requirement.scopes.filter(
        (scope) => !granted.has(scope)
      );
      if (missingScopes.length > 0) {
        return refuse(request, message, "insufficient_scope", requirement, {
          missingScopes,
        });
      }
    }

    if (authInfo !== undefined) {
      bag.authInfo = authInfo;
    }
    return next();
  };
}
