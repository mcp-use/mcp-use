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
import type { ToolSecurityScheme } from "../tools.js";
import { requiresSignIn, schemeScopes } from "./policy.js";

/** @internal Options for {@link createOAuthGate}. */
export interface OAuthGateOptions {
  /** Verifier bound to the canonical MCP resource. */
  verifier: OAuthTokenVerifier;
  /** RFC 9728 metadata URL advertised in every challenge. */
  resourceMetadataUrl: string;
  /** Provider `requiredScopes`, enforced on every sign-in request. */
  baselineScopes: readonly string[];
  /** Whether signed-out callers may connect, list, and call `noauth` tools. */
  mixedAuth: boolean;
  /** Resolved schemes for a tool name, or `undefined` for an unknown tool. */
  toolSchemes: (name: string) => readonly ToolSecurityScheme[] | undefined;
  /**
   * Resource URIs that `resources/read` serves signed out on a `mixedAuth`
   * server: the tools' views.
   */
  openResourceUris: Iterable<string>;
}

/**
 * Methods a signed-out caller may issue on a `mixedAuth` server: discovery
 * (`initialize` on 2025-era protocols, `server/discover` on 2026-07-28),
 * `ping`, the list methods, and the 2025-era `logging/setLevel`, which reads
 * no data. Refusing any of these would make hosts demand sign-in at
 * connection time. Apart from `tools/call` on `noauth` tools, reads of the
 * tools' views, and list-changed streams, every other method requires
 * sign-in, including reading other resources and getting prompts.
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

/** A resource URI in the form the SDK matches registered URIs against. */
function normalizeResourceUri(uri: string): string {
  try {
    return new URL(uri).toString();
  } catch {
    return uri;
  }
}

function stringParam(
  params: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = params?.[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Whether a message other than `tools/call` needs sign-in on a `mixedAuth`
 * server. Notifications are answered by the SDK without running any
 * callback, and a `subscriptions/listen` stream without resource
 * subscriptions carries only list-changed notifications, which reveal
 * nothing the open list methods do not.
 */
function isSignInMethod(message: ParsedMessage): boolean {
  if (SIGNED_OUT_METHODS.has(message.method)) return false;
  if (message.id === undefined && message.method.startsWith("notifications/")) {
    return false;
  }
  if (message.method === "subscriptions/listen") {
    const filter = message.params?.["notifications"];
    const uris = isRecord(filter) ? filter["resourceSubscriptions"] : undefined;
    return uris !== undefined && (!Array.isArray(uris) || uris.length > 0);
  }
  return true;
}

/**
 * Build the bearer gate that fronts the MCP endpoint.
 *
 * A token that is sent is always verified first; an invalid or expired one is
 * refused with `401` on every request. Then the JSON-RPC method, and for
 * `tools/call` the tool's `securitySchemes`, decide whether the request needs
 * sign-in, and which scopes. Verified identity is stashed on the request bag for the mount.
 *
 * Without `mixedAuth`, every request needs a token with the provider's
 * `requiredScopes`, plus the scopes of the tool it calls.
 *
 * @internal
 */
export function createOAuthGate(options: OAuthGateOptions): FetchMiddleware {
  const {
    verifier,
    resourceMetadataUrl,
    baselineScopes,
    mixedAuth,
    toolSchemes,
  } = options;
  const openResources = new Set(
    [...options.openResourceUris].map(normalizeResourceUri)
  );

  const open: Requirement = { required: false, scopes: [] };
  const signIn = (extra: readonly string[] = []): Requirement => ({
    required: true,
    scopes: [...new Set([...baselineScopes, ...extra])],
  });

  const requirementFor = (message: ParsedMessage | undefined): Requirement => {
    // Non-JSON-RPC bodies are answered by the SDK without running any
    // callback.
    if (message === undefined) return mixedAuth ? open : signIn();
    if (message.method === "tools/call") {
      const name = stringParam(message.params, "name");
      const schemes = name === undefined ? undefined : toolSchemes(name);
      // Unknown tools require sign-in with the baseline.
      if (schemes === undefined) return signIn();
      if (mixedAuth && !requiresSignIn(schemes)) return open;
      return signIn(schemeScopes(schemes));
    }
    if (!mixedAuth) return signIn();
    if (message.method === "resources/read") {
      // ChatGPT reads every tool's view while an app is being created,
      // before anyone signs in, and a refused read blocks creation. A view
      // is static UI; the data arrives in the tool result, which stays
      // gated by the tool's securitySchemes.
      const uri = stringParam(message.params, "uri");
      if (uri !== undefined && openResources.has(normalizeResourceUri(uri))) {
        return open;
      }
    }
    return isSignInMethod(message) ? signIn() : open;
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
