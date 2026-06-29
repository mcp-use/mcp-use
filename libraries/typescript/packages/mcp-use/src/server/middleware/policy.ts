import type {
  AuthContext,
  AuthDecision,
  AuthRequirement,
  PolicyRequest,
} from "../oauth/types.js";
import { createAuthContext } from "../oauth/utils.js";
import type { McpMiddlewareFn, MiddlewareContext } from "./mcp-middleware.js";

export class AuthzPolicyError extends Error {
  readonly data: Record<string, unknown>;

  constructor(decision: AuthDecision) {
    super(decision.message ?? "Access denied");
    this.name = "AuthzPolicyError";
    this.data = {
      code: decision.code ?? "forbidden",
      _meta: {
        "mcp-use/auth": {
          code: decision.code ?? "forbidden",
          required: decision.required,
          ...decision.meta,
        },
      },
    };
  }
}

interface AuthzMiddlewareOptions {
  getRequirement(request: PolicyRequest): AuthRequirement | undefined;
}

function authContextFromMiddleware(
  ctx: MiddlewareContext
): AuthContext | undefined {
  if (ctx.authContext) return ctx.authContext;
  if (!ctx.auth) return undefined;
  return ctx.auth.context ?? createAuthContext(ctx.auth);
}

function requirementSummary(
  requirement: AuthRequirement
): AuthDecision["required"] {
  return {
    scopes: requirement.scopes,
    scopesAny: requirement.scopesAny,
    permissions: requirement.permissions,
    permissionsAny: requirement.permissionsAny,
    roles: requirement.roles,
    rolesAny: requirement.rolesAny,
    authenticated: requirement.authenticated,
  };
}

function hasAll(values: string[], required?: string[]): boolean {
  return !required?.length || required.every((value) => values.includes(value));
}

function hasAny(values: string[], required?: string[]): boolean {
  return !required?.length || required.some((value) => values.includes(value));
}

function evaluateStaticRequirement(
  requirement: AuthRequirement | undefined,
  auth: AuthContext | undefined
): AuthDecision {
  if (!requirement) return { allow: true };

  const needsAuth =
    requirement.authenticated === true ||
    !!requirement.scopes?.length ||
    !!requirement.scopesAny?.length ||
    !!requirement.permissions?.length ||
    !!requirement.permissionsAny?.length ||
    !!requirement.roles?.length ||
    !!requirement.rolesAny?.length;

  if (needsAuth && !auth) {
    return {
      allow: false,
      code: "unauthenticated",
      message: "Authentication required",
      required: requirementSummary(requirement),
    };
  }

  if (!auth) return { allow: true };

  if (
    !hasAll(auth.scopes, requirement.scopes) ||
    !hasAny(auth.scopes, requirement.scopesAny)
  ) {
    return {
      allow: false,
      code: "insufficient_scope",
      message: "Missing required scope",
      required: requirementSummary(requirement),
    };
  }

  if (
    !hasAll(auth.permissions, requirement.permissions) ||
    !hasAny(auth.permissions, requirement.permissionsAny)
  ) {
    return {
      allow: false,
      code: "forbidden",
      message: "Missing required permission",
      required: requirementSummary(requirement),
    };
  }

  if (
    !hasAll(auth.roles, requirement.roles) ||
    !hasAny(auth.roles, requirement.rolesAny)
  ) {
    return {
      allow: false,
      code: "forbidden",
      message: "Missing required role",
      required: requirementSummary(requirement),
    };
  }

  return { allow: true };
}

export async function evaluateAuthRequirement(
  requirement: AuthRequirement | undefined,
  request: PolicyRequest,
  options: { includePredicate?: boolean } = {}
): Promise<AuthDecision> {
  const staticDecision = evaluateStaticRequirement(requirement, request.auth);
  if (
    !staticDecision.allow ||
    !requirement?.predicate ||
    !options.includePredicate
  ) {
    return staticDecision;
  }

  const predicateDecision = await requirement.predicate(request);
  if (typeof predicateDecision === "boolean") {
    return predicateDecision
      ? { allow: true }
      : {
          allow: false,
          code: "forbidden",
          message: "Access denied by policy",
          required: requirementSummary(requirement),
        };
  }

  return predicateDecision.allow
    ? predicateDecision
    : {
        ...predicateDecision,
        code: predicateDecision.code ?? "forbidden",
        required: predicateDecision.required ?? requirementSummary(requirement),
      };
}

function toolDenial(decision: AuthDecision): Record<string, unknown> {
  return {
    content: [
      {
        type: "text",
        text: decision.message ?? "Access denied",
      },
    ],
    isError: true,
    _meta: {
      "mcp-use/auth": {
        code: decision.code ?? "forbidden",
        required: decision.required,
        ...decision.meta,
      },
    },
  };
}

function getStringParam(
  ctx: MiddlewareContext,
  key: string
): string | undefined {
  const value = ctx.params[key];
  return typeof value === "string" ? value : undefined;
}

function callInput(
  ctx: MiddlewareContext
): Record<string, unknown> | undefined {
  const value = ctx.params.arguments;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function itemIdentifier(
  kind: PolicyRequest["kind"],
  item: unknown
): { name?: string; uri?: string } {
  if (!item || typeof item !== "object") return {};
  const record = item as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : undefined;
  const uri = typeof record.uri === "string" ? record.uri : undefined;
  return kind === "resource" ? { name, uri } : { name };
}

export function createAuthzMiddleware(
  options: AuthzMiddlewareOptions
): McpMiddlewareFn {
  return async (ctx, next) => {
    const auth = authContextFromMiddleware(ctx);
    ctx.authContext = auth;

    if (ctx.method === "tools/list") {
      const result = await next();
      return Array.isArray(result)
        ? await filterList("tool", "tools/list", result, auth, options)
        : result;
    }

    if (ctx.method === "resources/list") {
      const result = await next();
      return Array.isArray(result)
        ? await filterList("resource", "resources/list", result, auth, options)
        : result;
    }

    if (ctx.method === "prompts/list") {
      const result = await next();
      return Array.isArray(result)
        ? await filterList("prompt", "prompts/list", result, auth, options)
        : result;
    }

    const request = requestFromContext(ctx, auth);
    if (!request) return next();

    const requirement = options.getRequirement(request);
    const decision = await evaluateAuthRequirement(requirement, request, {
      includePredicate: true,
    });
    if (decision.allow) return next();

    if (ctx.method === "tools/call") {
      return toolDenial(decision);
    }

    throw new AuthzPolicyError(decision);
  };
}

function requestFromContext(
  ctx: MiddlewareContext,
  auth: AuthContext | undefined
): PolicyRequest | undefined {
  if (ctx.method === "tools/call") {
    const name = getStringParam(ctx, "name");
    return name
      ? {
          kind: "tool",
          operation: "tools/call",
          name,
          input: callInput(ctx),
          auth,
        }
      : undefined;
  }

  if (ctx.method === "resources/read") {
    const uri = getStringParam(ctx, "uri");
    return uri
      ? { kind: "resource", operation: "resources/read", uri, auth }
      : undefined;
  }

  if (ctx.method === "prompts/get") {
    const name = getStringParam(ctx, "name");
    return name
      ? { kind: "prompt", operation: "prompts/get", name, auth }
      : undefined;
  }

  return undefined;
}

async function filterList(
  kind: PolicyRequest["kind"],
  operation: PolicyRequest["operation"],
  items: unknown[],
  auth: AuthContext | undefined,
  options: AuthzMiddlewareOptions
): Promise<unknown[]> {
  const filtered: unknown[] = [];
  for (const item of items) {
    const { name, uri } = itemIdentifier(kind, item);
    const request: PolicyRequest = { kind, operation, name, uri, auth };
    const requirement = options.getRequirement(request);
    const decision = await evaluateAuthRequirement(requirement, request);
    if (decision.allow) filtered.push(item);
  }
  return filtered;
}
