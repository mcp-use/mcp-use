import type { UserInfo } from "./providers/types.js";

export interface AuthContext {
  subject?: string;
  user?: UserInfo;
  claims: Record<string, unknown>;
  scopes: string[];
  permissions: string[];
  roles: string[];
  organization?: {
    id?: string;
    slug?: string;
    name?: string;
  };
  hasScope(scope: string): boolean;
  hasPermission(permission: string): boolean;
  hasRole(role: string): boolean;
  can(action: string, resource?: { type?: string; id?: string }): boolean;
}

export interface AuthDecision {
  allow: boolean;
  code?: "unauthenticated" | "insufficient_scope" | "forbidden";
  message?: string;
  required?: AuthRequirementSummary;
  meta?: Record<string, unknown>;
}

export interface AuthRequirementSummary {
  scopes?: string[];
  scopesAny?: string[];
  permissions?: string[];
  permissionsAny?: string[];
  roles?: string[];
  rolesAny?: string[];
  authenticated?: boolean;
}

export interface PolicyRequest {
  kind: "tool" | "resource" | "prompt";
  operation:
    | "tools/list"
    | "tools/call"
    | "resources/list"
    | "resources/read"
    | "prompts/list"
    | "prompts/get";
  name?: string;
  uri?: string;
  input?: Record<string, unknown>;
  auth?: AuthContext;
}

export type AuthPredicate = (
  request: PolicyRequest & { auth?: AuthContext }
) => boolean | AuthDecision | Promise<boolean | AuthDecision>;

export interface AuthRequirement extends AuthRequirementSummary {
  predicate?: AuthPredicate;
}

export interface Policy {
  evaluate(
    requirement: AuthRequirement | undefined,
    request: PolicyRequest
  ): Promise<AuthDecision>;
}
