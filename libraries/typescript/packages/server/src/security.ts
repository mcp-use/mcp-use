import type { OAuthAuth } from "./context.js";
import type { ToolDefinition } from "./tools.js";

/** Authenticated identity exposed to a security policy without bearer tokens. */
export type SecurityAuth<TUser = unknown> = Pick<
  OAuthAuth<TUser>,
  | "user"
  | "payload"
  | "scopes"
  | "permissions"
  | "clientId"
  | "expiresAt"
  | "resource"
>;

/** Context evaluated before a tool callback is allowed to run. */
export interface ToolSecurityContext<TUser = unknown> {
  tool: ToolDefinition;
  arguments: Record<string, unknown>;
  auth?: SecurityAuth<TUser>;
  request?: Request;
  signal: AbortSignal;
}

/** Result returned by a security policy. */
export interface SecurityDecision {
  allowed: boolean;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/** Lifecycle stage recorded for a tool call. */
export type SecurityAuditPhase =
  | "requested"
  | "denied"
  | "completed"
  | "failed";

/** Redacted, structured record emitted by the runtime security layer. */
export interface SecurityAuditEvent<TUser = unknown> {
  id: string;
  type: "tool.call";
  phase: SecurityAuditPhase;
  timestamp: string;
  tool: string;
  arguments?: unknown;
  decision?: SecurityDecision;
  durationMs?: number;
  error?: { name: string; message: string };
}

/** Runtime security hooks for MCP tool calls. */
export interface SecurityOptions<TUser = unknown> {
  /** Return whether a tool call may execute. */
  policy: (
    context: ToolSecurityContext<TUser>
  ) => SecurityDecision | Promise<SecurityDecision>;
  /** Receive lifecycle events without affecting tool execution. */
  audit?: (event: SecurityAuditEvent<TUser>) => void | Promise<void>;
  /** Redact or select arguments before they are included in audit events. */
  redactArguments?: (
    arguments_: Record<string, unknown>,
    context: ToolSecurityContext<TUser>
  ) => unknown;
}
