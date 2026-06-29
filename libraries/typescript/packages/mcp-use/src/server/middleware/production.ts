import type { ToolAnnotations } from "../types/tool.js";
import type {
  McpMiddlewareFn,
  MiddlewareContext,
  ToolsCallMiddlewareContext,
} from "./mcp-middleware.js";

export const DEFAULT_IDEMPOTENCY_STATE_KEY = "idempotencyKey";
export const DEFAULT_TIMEOUT_SIGNAL_STATE_KEY = "abortSignal";

export class TimeoutPolicyError extends Error {
  readonly data: Record<string, unknown>;

  constructor(method: string, timeoutMs: number) {
    super(`MCP operation ${method} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutPolicyError";
    this.data = {
      code: "timeout",
      timeoutMs,
      _meta: {
        "mcp-use/timeout": {
          code: "timeout",
          timeoutMs,
        },
      },
    };
  }
}

export interface TimeoutPolicyOptions {
  /** Timeout in milliseconds, or a request-scoped timeout picker. */
  timeoutMs: number | ((ctx: MiddlewareContext) => number | undefined);
  /** Optional MCP methods to time out. Defaults to every operation. */
  methods?: readonly string[];
  /** State key used to expose the cooperative cancellation signal to handlers. */
  signalStateKey?: string;
  /** State key used to expose the resolved timeout to handlers. */
  timeoutStateKey?: string;
}

function resolveTimeoutMs(
  ctx: MiddlewareContext,
  timeoutMs: TimeoutPolicyOptions["timeoutMs"]
): number | undefined {
  const value = typeof timeoutMs === "function" ? timeoutMs(ctx) : timeoutMs;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function shouldRunForMethod(
  method: string,
  methods: readonly string[] | undefined
): boolean {
  return !methods?.length || methods.includes(method);
}

/**
 * Add a hard timeout around MCP operations.
 *
 * The middleware races `next()` with a timer and stores an `AbortSignal` in
 * `ctx.state` so cooperative handlers can stop their own work early. It does
 * not try to kill arbitrary user code after the timeout; JavaScript cannot do
 * that safely without a separate runtime.
 */
export function createTimeoutPolicyMiddleware(
  options: TimeoutPolicyOptions
): McpMiddlewareFn {
  const signalStateKey =
    options.signalStateKey ?? DEFAULT_TIMEOUT_SIGNAL_STATE_KEY;
  const timeoutStateKey = options.timeoutStateKey ?? "timeoutMs";

  return async (ctx, next) => {
    if (!shouldRunForMethod(ctx.method, options.methods)) return next();

    const timeoutMs = resolveTimeoutMs(ctx, options.timeoutMs);
    if (!timeoutMs) return next();

    const controller = new AbortController();
    ctx.state.set(signalStateKey, controller.signal);
    ctx.state.set(timeoutStateKey, timeoutMs);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new TimeoutPolicyError(ctx.method, timeoutMs);
        controller.abort(error);
        reject(error);
      }, timeoutMs);
    });

    try {
      return await Promise.race([next(), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

export interface IdempotencyKeyOptions {
  /**
   * Accepted key names. Defaults cover common JS, JSON, and HTTP spellings.
   */
  keys?: readonly string[];
}

export type MutatingToolMatcher =
  | readonly string[]
  | ReadonlySet<string>
  | RegExp
  | ((name: string, ctx: ToolsCallMiddlewareContext) => boolean);

export interface IdempotencyKeyMiddlewareOptions extends IdempotencyKeyOptions {
  /** Mutating tools that must carry an idempotency key. */
  mutatingTools?: MutatingToolMatcher;
  /** Override mutating-tool detection entirely. */
  isMutatingTool?: (ctx: ToolsCallMiddlewareContext) => boolean;
  /** Defaults to true for matched mutating tools. */
  requireKey?: boolean;
  /** State key where the resolved key is stored. */
  stateKey?: string;
}

const DEFAULT_IDEMPOTENCY_KEYS = [
  "idempotencyKey",
  "idempotency_key",
  "idempotency-key",
  "Idempotency-Key",
] as const;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstStringValue(
  record: Record<string, unknown> | undefined,
  keys: readonly string[]
): string | undefined {
  if (!record) return undefined;

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return undefined;
}

function isToolsCallContext(
  ctx: MiddlewareContext
): ctx is ToolsCallMiddlewareContext {
  return ctx.method === "tools/call" && typeof ctx.params.name === "string";
}

function matchesMutatingTool(
  ctx: ToolsCallMiddlewareContext,
  options: IdempotencyKeyMiddlewareOptions
): boolean {
  if (options.isMutatingTool) return options.isMutatingTool(ctx);

  const matcher = options.mutatingTools;
  if (!matcher) return false;

  const name = ctx.params.name;
  if (typeof matcher === "function") return matcher(name, ctx);
  if (matcher instanceof RegExp) return matcher.test(name);
  if (Array.isArray(matcher)) return matcher.includes(name);
  return (matcher as ReadonlySet<string>).has(name);
}

function missingIdempotencyKeyResult(
  toolName: string
): Record<string, unknown> {
  return {
    content: [
      {
        type: "text",
        text: `Tool ${toolName} requires an idempotency key`,
      },
    ],
    isError: true,
    _meta: {
      "mcp-use/idempotency": {
        code: "missing_idempotency_key",
        required: true,
      },
    },
  };
}

/**
 * Resolve an idempotency key from a tool call.
 *
 * Keys may be supplied in `params._meta`, request `_meta`, or tool arguments.
 * This helper only extracts and normalizes the key; it intentionally does not
 * cache or replay results.
 */
export function getIdempotencyKey(
  ctx: MiddlewareContext,
  options: IdempotencyKeyOptions = {}
): string | undefined {
  const keys = options.keys ?? DEFAULT_IDEMPOTENCY_KEYS;
  const paramsMeta = asRecord(ctx.params._meta);
  const requestMeta = asRecord(ctx.requestMeta);
  const args = asRecord(ctx.params.arguments);

  return (
    firstStringValue(paramsMeta, keys) ??
    firstStringValue(requestMeta, keys) ??
    firstStringValue(args, keys)
  );
}

/**
 * Store idempotency keys on `ctx.state` and optionally require them for
 * explicitly matched mutating tools.
 */
export function createIdempotencyKeyMiddleware(
  options: IdempotencyKeyMiddlewareOptions = {}
): McpMiddlewareFn {
  const stateKey = options.stateKey ?? DEFAULT_IDEMPOTENCY_STATE_KEY;
  const requireKey = options.requireKey ?? true;

  return async (ctx, next) => {
    if (!isToolsCallContext(ctx)) return next();

    const key = getIdempotencyKey(ctx, options);
    if (key) ctx.state.set(stateKey, key);

    if (requireKey && matchesMutatingTool(ctx, options) && !key) {
      return missingIdempotencyKeyResult(ctx.params.name);
    }

    return next();
  };
}

export interface AuditLogEvent {
  type: "mcp.operation";
  timestamp: string;
  method: string;
  toolName?: string;
  resourceUri?: string;
  promptName?: string;
  sessionId?: string;
  subject?: string;
  scopes?: readonly string[];
  idempotencyKey?: string;
  durationMs: number;
  success: boolean;
  error?: {
    name: string;
    message: string;
  };
}

export interface AuditLogMiddlewareOptions {
  onEvent(event: AuditLogEvent): void | Promise<void>;
  /** Defaults to Date.now. Useful for deterministic tests. */
  now?: () => number;
  /** Defaults to false so audit sink failures do not break tool calls. */
  throwOnAuditError?: boolean;
}

function stringParam(ctx: MiddlewareContext, key: string): string | undefined {
  const value = ctx.params[key];
  return typeof value === "string" ? value : undefined;
}

function errorDetails(error: unknown): AuditLogEvent["error"] {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: "Error", message: String(error) };
}

function subjectFromContext(ctx: MiddlewareContext): string | undefined {
  const userSub = ctx.auth?.user?.sub;
  return (
    ctx.authContext?.subject ??
    (typeof userSub === "string" ? userSub : undefined)
  );
}

/**
 * Emit one structured audit event for each MCP operation.
 */
export function createAuditLogMiddleware(
  options: AuditLogMiddlewareOptions
): McpMiddlewareFn {
  const now = options.now ?? Date.now;

  return async (ctx, next) => {
    const startedAt = now();
    let success = false;
    let caughtError: unknown;
    let result: unknown;

    try {
      result = await next();
      success = true;
    } catch (error) {
      caughtError = error;
    }

    const event: AuditLogEvent = {
      type: "mcp.operation",
      timestamp: new Date(startedAt).toISOString(),
      method: ctx.method,
      toolName:
        ctx.method === "tools/call" ? stringParam(ctx, "name") : undefined,
      resourceUri:
        ctx.method === "resources/read" ? stringParam(ctx, "uri") : undefined,
      promptName:
        ctx.method === "prompts/get" ? stringParam(ctx, "name") : undefined,
      sessionId: ctx.session?.sessionId,
      subject: subjectFromContext(ctx),
      scopes: ctx.authContext?.scopes ?? ctx.auth?.scopes,
      idempotencyKey:
        typeof ctx.state.get(DEFAULT_IDEMPOTENCY_STATE_KEY) === "string"
          ? (ctx.state.get(DEFAULT_IDEMPOTENCY_STATE_KEY) as string)
          : getIdempotencyKey(ctx),
      durationMs: Math.max(0, now() - startedAt),
      success,
      error: caughtError ? errorDetails(caughtError) : undefined,
    };

    try {
      await options.onEvent(event);
    } catch (auditError) {
      if (options.throwOnAuditError && !caughtError) throw auditError;
    }

    if (caughtError) throw caughtError;
    return result;
  };
}

export type SecurityDoctorSeverity = "info" | "warning" | "error";

export interface SecurityDoctorFinding {
  id: string;
  severity: SecurityDoctorSeverity;
  message: string;
  recommendation: string;
  target?: {
    kind: "server" | "auth" | "tool" | "host" | "origin";
    name?: string;
  };
}

export interface SecurityDoctorReport {
  ok: boolean;
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
  findings: SecurityDoctorFinding[];
}

export interface SecurityDoctorTool {
  name: string;
  description?: string;
  annotations?: Partial<ToolAnnotations> & Record<string, unknown>;
  auth?: unknown;
  _meta?: Record<string, unknown>;
}

export interface SecurityDoctorInput {
  remote?: boolean;
  auth?: {
    enabled?: boolean;
    issuer?: string;
    audience?: string;
  };
  hostValidation?: {
    enabled?: boolean;
    allowedHosts?: readonly string[];
  };
  originValidation?: {
    enabled?: boolean;
    allowedOrigins?: readonly string[];
  };
  idempotency?: {
    mutatingTools?: readonly string[] | "all";
  };
  tools?: readonly SecurityDoctorTool[];
}

function addFinding(
  findings: SecurityDoctorFinding[],
  finding: SecurityDoctorFinding
): void {
  findings.push(finding);
}

function annotationFlag(
  tool: SecurityDoctorTool,
  key: string
): boolean | undefined {
  const value = tool.annotations?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function isLikelyMutatingTool(tool: SecurityDoctorTool): boolean {
  if (annotationFlag(tool, "readOnlyHint") === true) return false;
  if (annotationFlag(tool, "destructiveHint") === true) return true;
  return /^(create|update|delete|remove|write|send|cancel|charge|refund|invite|disable|enable)[_-]/i.test(
    tool.name
  );
}

function idempotencyCoversTool(
  tool: SecurityDoctorTool,
  idempotency: SecurityDoctorInput["idempotency"]
): boolean {
  if (idempotency?.mutatingTools === "all") return true;
  return idempotency?.mutatingTools?.includes(tool.name) ?? false;
}

function summarize(
  findings: readonly SecurityDoctorFinding[]
): SecurityDoctorReport["summary"] {
  return {
    errors: findings.filter((finding) => finding.severity === "error").length,
    warnings: findings.filter((finding) => finding.severity === "warning")
      .length,
    info: findings.filter((finding) => finding.severity === "info").length,
  };
}

/**
 * Build CI/doctor-friendly security findings from plain server metadata.
 *
 * This is intentionally only a data model and lint helper. It does not enforce
 * policy at runtime; use auth and MCP middleware for enforcement.
 */
export function lintMcpSecurity(
  input: SecurityDoctorInput
): SecurityDoctorReport {
  const findings: SecurityDoctorFinding[] = [];

  if (input.remote && !input.auth?.enabled) {
    addFinding(findings, {
      id: "remote-server-without-auth",
      severity: "error",
      message: "Remote MCP server has no authentication configured.",
      recommendation:
        "Configure OAuth or another bearer-token verifier before deploying remotely.",
      target: { kind: "server" },
    });
  }

  if (input.remote && !input.hostValidation?.enabled) {
    addFinding(findings, {
      id: "host-validation-disabled",
      severity: "warning",
      message: "Remote server does not report Host validation.",
      recommendation:
        "Restrict allowed Host headers to the public deployment hosts.",
      target: { kind: "host" },
    });
  }

  if (
    input.remote &&
    input.originValidation?.enabled &&
    !input.originValidation.allowedOrigins?.length
  ) {
    addFinding(findings, {
      id: "origin-validation-without-allowlist",
      severity: "warning",
      message: "Origin validation is enabled without an allowlist.",
      recommendation:
        "Set the exact browser/client origins that may call this server.",
      target: { kind: "origin" },
    });
  }

  if (input.auth?.enabled && input.remote && !input.auth.issuer) {
    addFinding(findings, {
      id: "oauth-issuer-missing",
      severity: "warning",
      message: "OAuth is enabled but no issuer was reported.",
      recommendation:
        "Validate JWT issuer so tokens from other tenants cannot be replayed.",
      target: { kind: "auth" },
    });
  }

  if (input.auth?.enabled && input.remote && !input.auth.audience) {
    addFinding(findings, {
      id: "oauth-audience-missing",
      severity: "warning",
      message: "OAuth is enabled but no audience was reported.",
      recommendation:
        "Validate JWT audience so tokens minted for other APIs are rejected.",
      target: { kind: "auth" },
    });
  }

  for (const tool of input.tools ?? []) {
    const mutating = isLikelyMutatingTool(tool);
    if (!mutating) continue;

    if (!tool.auth) {
      addFinding(findings, {
        id: "mutating-tool-without-auth",
        severity: "warning",
        message: `Mutating tool ${tool.name} has no auth requirement metadata.`,
        recommendation:
          "Add an auth requirement or verify that this tool is intentionally public.",
        target: { kind: "tool", name: tool.name },
      });
    }

    if (
      annotationFlag(tool, "destructiveHint") !== true &&
      /^(delete|remove|charge|refund|disable)[_-]/i.test(tool.name)
    ) {
      addFinding(findings, {
        id: "destructive-tool-without-annotation",
        severity: "warning",
        message: `Destructive-looking tool ${tool.name} is missing destructiveHint.`,
        recommendation:
          "Set annotations.destructiveHint so clients can ask for appropriate confirmation.",
        target: { kind: "tool", name: tool.name },
      });
    }

    if (!idempotencyCoversTool(tool, input.idempotency)) {
      addFinding(findings, {
        id: "mutating-tool-without-idempotency",
        severity: "info",
        message: `Mutating tool ${tool.name} is not covered by idempotency metadata.`,
        recommendation:
          "Use createIdempotencyKeyMiddleware for retryable mutating calls.",
        target: { kind: "tool", name: tool.name },
      });
    }
  }

  const summary = summarize(findings);
  return {
    ok: summary.errors === 0,
    summary,
    findings,
  };
}
