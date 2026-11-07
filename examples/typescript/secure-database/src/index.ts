import { MCPServer } from "mcp-use";
import { z } from "zod";
import {
  sqlValidator,
  UserRole,
  ROLE_ALLOWED_TABLES,
  PII_COLUMNS,
  MAX_QUERY_LENGTH,
} from "./validator.js";
import { dbEngine } from "./engine.js";

// Demo tokens for role resolution
const ROLES: Record<string, { role: UserRole; label: string }> = {
  "token-viewer-demo": { role: "public_viewer", label: "Public Viewer (Metadata Only)" },
  "token-analyst-demo": { role: "analyst", label: "Data Analyst (Analytics Allowed, PII Blocked)" },
  "token-admin-demo": { role: "admin", label: "Security Administrator (Full Access + PII)" },
};

export const ROLE_ALLOWED_TOOLS: Record<UserRole, readonly string[]> = {
  unauthenticated: ["whoami"],
  public_viewer: ["whoami", "list_tables", "describe_table", "verify_query_safety"],
  analyst: [
    "whoami",
    "list_tables",
    "describe_table",
    "verify_query_safety",
    "execute_analytical_sql",
  ],
  admin: [
    "whoami",
    "list_tables",
    "describe_table",
    "verify_query_safety",
    "execute_analytical_sql",
    "get_security_audit_log",
  ],
};

function resolveCallerRole(token?: string | null): UserRole {
  if (!token) return "unauthenticated";
  const clean = token.replace(/^Bearer\s+/i, "").trim();
  return ROLES[clean]?.role ?? "unauthenticated";
}

function extractContextToken(args?: { token?: string | undefined }, ctx?: any): string | undefined {
  if (typeof args?.token === "string" && args.token.trim()) {
    return args.token.trim();
  }
  const authHeader = ctx?.request?.header?.("authorization");
  if (authHeader) {
    return authHeader.replace(/^Bearer\s+/i, "").trim();
  }
  const apiKey = ctx?.request?.header?.("x-api-key");
  if (apiKey) {
    return apiKey.trim();
  }
  const queryToken =
    ctx?.request?.query?.("token") ||
    ctx?.request?.query?.("apiKey") ||
    ctx?.request?.query?.("api_key");
  if (queryToken) {
    return queryToken.trim();
  }
  return undefined;
}

function resolveContextRole(args?: { token?: string | undefined }, ctx?: any): UserRole {
  const token = extractContextToken(args, ctx);
  return resolveCallerRole(token);
}

interface AuditEntry {
  timestamp: string;
  role: string;
  tool: string;
  query?: string | undefined;
  status: string;
  detail?: string | undefined;
}

const auditLog: AuditEntry[] = [];
const MAX_AUDIT_QUERY_LENGTH = 500;

function recordAudit(role: string, tool: string, status: string, query?: string, detail?: string) {
  const sanitizedQuery =
    typeof query === "string"
      ? query.length > MAX_AUDIT_QUERY_LENGTH
        ? `${query.slice(0, MAX_AUDIT_QUERY_LENGTH)}... [truncated]`
        : query
      : undefined;

  auditLog.unshift({
    timestamp: new Date().toISOString(),
    role,
    tool,
    query: sanitizedQuery,
    status,
    detail: detail ?? undefined,
  });
  if (auditLog.length > 50) auditLog.pop();
}

const server = new MCPServer({
  name: "secure-database-example",
  version: "1.0.0",
  description:
    "Sandboxed analytical SQL database server demonstrating default-deny RBAC, AST validation, worker isolation, and PII protection.",
});

// Middleware: Dynamic tool visibility on tools/list
server.use("mcp:tools/list", async (ctx, next) => {
  const token = extractContextToken(undefined, ctx);
  const role = resolveCallerRole(token);
  const allTools = await next();

  if (role === "admin") {
    return allTools;
  }
  if (role === "public_viewer") {
    return allTools.filter((t: any) =>
      ROLE_ALLOWED_TOOLS.public_viewer.includes(t.name)
    );
  }
  // For 'analyst' or transport-unauthenticated callers (who pass token via tool args):
  // Expose the database tools (which take an optional token arg), but hide admin-only audit log.
  return allTools.filter((t: any) => t.name !== "get_security_audit_log");
});

// Middleware: Wire-level authorization check on tools/call
server.use("mcp:tools/call", async (ctx, next) => {
  const toolName = ctx.params.name;
  const args = (ctx.params.arguments ?? {}) as Record<string, unknown>;
  const token = extractContextToken(args as any, ctx);
  const role = resolveCallerRole(token);

  // Propagate resolved token into tool arguments so tool handlers always see the effective credential
  if (token && typeof args.token !== "string") {
    (ctx.params.arguments as Record<string, unknown>).token = token;
  }

  const allowedTools = ROLE_ALLOWED_TOOLS[role] ?? [];
  if (!allowedTools.includes(toolName)) {
    const isUnauth = role === "unauthenticated";
    recordAudit(
      role,
      toolName,
      isUnauth ? "BLOCKED_AUTH" : "BLOCKED_RBAC",
      undefined,
      isUnauth ? "Authentication required" : `Tool '${toolName}' not allowed for role '${role}'`
    );

    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: isUnauth
            ? "AuthenticationRequired: Provide a valid Bearer token (e.g. token-analyst-demo) via Authorization header, ?token query parameter, or tool argument."
            : `PermissionDenied: Role '${role}' is not authorized to invoke tool '${toolName}'.`,
        },
      ],
    };
  }

  return next();
});

// Tool 1: Identity verification
export const whoami = server.tool(
  {
    name: "whoami",
    description: "Returns the authenticated role and permissions of the caller.",
    inputSchema: z.object({
      token: z.string().optional().describe("Optional Bearer token for identity resolution"),
    }),
  },
  async (args, ctx) => {
    const role = resolveContextRole(args, ctx);
    const label = Object.values(ROLES).find((r) => r.role === role)?.label ?? "Unauthenticated Caller";
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              role,
              label,
              authorizedTables: ROLE_ALLOWED_TABLES[role],
              piiAccess: role === "admin",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool 2: Catalog discovery
export const listTables = server.tool(
  {
    name: "list_tables",
    description: "Lists database tables visible to the caller's role.",
    inputSchema: z.object({
      token: z.string().optional().describe("Authentication token"),
    }),
  },
  async (args, ctx) => {
    const role = resolveContextRole(args, ctx);
    const tables = ROLE_ALLOWED_TABLES[role];
    recordAudit(role, "list_tables", "SUCCESS");
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ role, tables }, null, 2),
        },
      ],
    };
  }
);

// Tool 3: Schema inspection
export const describeTable = server.tool(
  {
    name: "describe_table",
    description: "Inspects table schema and columns, hiding PII columns for non-admins.",
    inputSchema: z.object({
      tableName: z.string().describe("Table name to inspect"),
      token: z.string().optional().describe("Authentication token"),
    }),
  },
  async ({ tableName, token }, ctx) => {
    const role = resolveContextRole({ token }, ctx);
    const tbl = tableName.toLowerCase();
    const allowed = new Set(ROLE_ALLOWED_TABLES[role]);

    if (!allowed.has(tbl)) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Table '${tbl}' not found or access denied.` }],
      };
    }

    const schemas: Record<string, string[]> = {
      customers: ["id", "name", "plan", "billing_email", "stripe_customer_id"],
      products: ["id", "sku", "title", "price_usd"],
      orders: ["id", "customer_id", "product_id", "amount_usd", "created_at"],
      api_secrets: ["id", "service_name", "secret_token"],
    };

    const columns = (schemas[tbl] ?? []).filter((col) => role === "admin" || !PII_COLUMNS.has(col));
    recordAudit(role, "describe_table", "SUCCESS", tbl);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ table: tbl, columns, piiFiltered: role !== "admin" }, null, 2),
        },
      ],
    };
  }
);

// Tool 4: Pre-execution validation
export const verifyQuerySafety = server.tool(
  {
    name: "verify_query_safety",
    description: "Performs dry-run AST validation on a SQL query without executing it.",
    inputSchema: z.object({
      query: z
        .string()
        .max(MAX_QUERY_LENGTH, `Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`)
        .describe("SQL SELECT statement to validate"),
      token: z.string().optional().describe("Authentication token"),
    }),
  },
  async ({ query, token }, ctx) => {
    const role = resolveContextRole({ token }, ctx);
    const validation = sqlValidator.validate(query, role);
    recordAudit(role, "verify_query_safety", validation.valid ? "PASSED" : "FAILED", query, validation.error);

    return {
      isError: !validation.valid,
      content: [{ type: "text" as const, text: JSON.stringify(validation, null, 2) }],
    };
  }
);

// Tool 5: Sandboxed SQL execution
export const executeAnalyticalSql = server.tool(
  {
    name: "execute_analytical_sql",
    description: "Executes an analytical SELECT SQL query in an isolated, memory-constrained SQLite sandbox.",
    inputSchema: z.object({
      query: z
        .string()
        .max(MAX_QUERY_LENGTH, `Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`)
        .describe("SQL SELECT query to execute"),
      token: z.string().optional().describe("Authentication token"),
    }),
  },
  async ({ query, token }, ctx) => {
    const role = resolveContextRole({ token }, ctx);

    // Layer 2: AST Validation
    const validation = sqlValidator.validate(query, role);
    if (!validation.valid) {
      recordAudit(role, "execute_analytical_sql", "BLOCKED_VALIDATION", query, validation.error);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `ASTValidationError: ${validation.error}` }],
      };
    }

    // Layer 3 & 4: Worker Sandbox execution with compile-time authorizer & hard deadline
    try {
      const result = await dbEngine.executeQuery(validation.sanitizedQuery!, role);
      recordAudit(role, "execute_analytical_sql", "SUCCESS", query, `${result.rowCount} rows`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      recordAudit(role, "execute_analytical_sql", "EXECUTION_ERROR", query, err.message);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `ExecutionFailed: ${err.message}` }],
      };
    }
  }
);

// Tool 6: Audit log telemetry
export const getSecurityAuditLog = server.tool(
  {
    name: "get_security_audit_log",
    description: "Returns recent security audit events and telemetry. Admin role required.",
    inputSchema: z.object({
      token: z.string().optional().describe("Admin authentication token"),
    }),
  },
  async (args, ctx) => {
    const role = resolveContextRole(args, ctx);
    if (role !== "admin") {
      return {
        isError: true,
        content: [{ type: "text" as const, text: "PermissionDenied: Admin privileges required." }],
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ count: auditLog.length, events: auditLog }, null, 2),
        },
      ],
    };
  }
);

// Resource: Role-filtered catalog
server.resource({ name: "catalog", uri: "schema://catalog" }, async (uri, ctx) => {
  const role = resolveContextRole(undefined, ctx);

  if (role === "unauthenticated") {
    return {
      contents: [{ uri: uri.href, mimeType: "text/plain", text: "Access denied. Authentication required." }],
    };
  }

  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({ role, allowedTables: ROLE_ALLOWED_TABLES[role] }, null, 2),
      },
    ],
  };
});

// Prompt: Analytical query assistant
server.prompt(
  {
    name: "analyze_metrics",
    schema: z.object({
      metric: z.enum(["revenue", "customers", "products"]).default("revenue"),
    }),
  },
  async ({ metric }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are a data analyst. Write a safe SELECT query to analyze ${metric}. Do not query PII columns or use SELECT *.`,
        },
      },
    ],
  })
);

export { sqlValidator, dbEngine };
export default server;
