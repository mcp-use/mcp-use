import { DatabaseSync } from "node:sqlite";
import { MCPServer } from "mcp-use";
import { z } from "zod";

type Role = "viewer" | "analyst" | "admin";

const TOKENS: Record<string, Role> = {
  "token-viewer": "viewer",
  "token-analyst": "analyst",
  "token-admin": "admin",
};

const ROLE_TOOLS: Record<Role, readonly string[]> = {
  viewer: ["list_tables"],
  analyst: ["list_tables", "query_analytics"],
  admin: ["list_tables", "query_analytics", "get_customer_billing"],
};

const MAX_ROWS = 100;
const MAX_QUERY_LENGTH = 1000;
const MAX_EXECUTION_MS = 2000;

function resolveRole(authHeader?: string): Role | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) return null;
  const token = match[1].trim();
  if (Object.hasOwn(TOKENS, token)) {
    const role = TOKENS[token];
    return role ?? null;
  }
  return null;
}

// 1. Seed in-memory SQLite databases with engine-level write protection and resource limits
const analyticsDb = new DatabaseSync(":memory:");
analyticsDb.exec(`
  PRAGMA max_page_count = 5000;
  CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price_usd REAL NOT NULL);
  CREATE TABLE orders (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, customer_tier TEXT NOT NULL, amount_usd REAL NOT NULL);
  INSERT INTO products VALUES (1, 'Starter Plan', 'subscription', 29), (2, 'Pro Plan', 'subscription', 99), (3, 'Audit Add-on', 'addon', 49);
  INSERT INTO orders VALUES (1, 1, 'self_serve', 29), (2, 2, 'enterprise', 990), (3, 3, 'enterprise', 490);
  PRAGMA query_only = ON;
`);

// Sensitive PII is separated into billingDb, accessible only via admin-gated lookup
const billingDb = new DatabaseSync(":memory:");
billingDb.exec(`
  PRAGMA max_page_count = 5000;
  CREATE TABLE customer_billing (id INTEGER PRIMARY KEY, company TEXT NOT NULL, billing_email TEXT NOT NULL, plan TEXT NOT NULL);
  INSERT INTO customer_billing VALUES (1, 'Acme Corp', 'billing@acme.com', 'enterprise'), (2, 'Globex Inc', 'ap@globex.io', 'starter');
  PRAGMA query_only = ON;
`);

const server = new MCPServer({
  name: "secure-database-example",
  version: "1.0.0",
  description:
    "Role-based SQLite MCP server with engine-level read-only enforcement and MCP middleware.",
});

// 2. Protocol middleware: Dynamic tool visibility per role on tools/list
server.use("mcp:tools/list", async (ctx, next) => {
  const role = resolveRole(ctx.request?.header("authorization"));
  const allTools = await next();
  if (!role) return [];
  const allowed = new Set(ROLE_TOOLS[role]);
  return allTools.filter((tool) => allowed.has(tool.name));
});

// 3. Protocol middleware: Enforce role-to-tool authorization on tools/call
server.use("mcp:tools/call", async (ctx, next) => {
  const role = resolveRole(ctx.request?.header("authorization"));
  if (!role) {
    throw new Error(
      "Unauthorized: Provide a valid Bearer token via Authorization header.",
    );
  }
  const allowed = ROLE_TOOLS[role] ?? [];
  if (!allowed.includes(ctx.params.name)) {
    throw new Error(
      `Forbidden: Role '${role}' is not authorized to call tool '${ctx.params.name}'.`,
    );
  }
  return next();
});

// Tool 1: Catalog discovery (viewer, analyst, admin)
server.tool(
  {
    name: "list_tables",
    description: "Lists queryable analytics tables and column schemas.",
    inputSchema: z.object({}),
  },
  async () => {
    const tables = [
      { table: "products", columns: ["id", "name", "category", "price_usd"] },
      {
        table: "orders",
        columns: ["id", "product_id", "customer_tier", "amount_usd"],
      },
    ];
    return {
      content: [{ type: "text", text: JSON.stringify(tables, null, 2) }],
    };
  },
);

// Tool 2: Sandboxed analytical query (analyst, admin)
server.tool(
  {
    name: "query_analytics",
    description: "Executes a read-only SELECT query against analytics tables.",
    inputSchema: z.object({
      sql: z
        .string()
        .max(
          MAX_QUERY_LENGTH,
          `Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`,
        )
        .describe(
          "SQL SELECT statement (e.g. SELECT p.name, SUM(o.amount_usd) FROM orders o JOIN products p ON p.id = o.product_id GROUP BY p.name)",
        ),
    }),
  },
  async ({ sql }) => {
    const query = sql.trim().replace(/;+\s*$/, "");
    if (query.length > MAX_QUERY_LENGTH) {
      throw new Error(
        `Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters.`,
      );
    }
    if (
      !/^SELECT\b/i.test(query) ||
      /\bWITH\b/i.test(query) ||
      /\bPRAGMA\b/i.test(query) ||
      query.includes(";") ||
      /--|\/\*/.test(query)
    ) {
      throw new Error(
        "Only a single SELECT statement without CTEs (WITH), PRAGMAs, or comments is permitted.",
      );
    }

    const limitedQuery = `SELECT * FROM (${query}) LIMIT ${MAX_ROWS}`;
    const stmt = analyticsDb.prepare(limitedQuery);
    const rows: Record<string, unknown>[] = [];
    const startTime = Date.now();
    for (const row of stmt.iterate()) {
      if (Date.now() - startTime > MAX_EXECUTION_MS) {
        throw new Error(
          `Query exceeded maximum execution time of ${MAX_EXECUTION_MS}ms.`,
        );
      }
      rows.push(row);
      if (rows.length >= MAX_ROWS) break;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ rowCount: rows.length, rows }, null, 2),
        },
      ],
    };
  },
);

// Tool 3: Parameterized customer billing lookup (admin only)
server.tool(
  {
    name: "get_customer_billing",
    description:
      "Inspect customer billing details and contact emails. Admin role required.",
    inputSchema: z.object({
      company: z.string().optional().describe("Optional company name filter"),
    }),
  },
  async ({ company }) => {
    const sql = company
      ? "SELECT id, company, billing_email, plan FROM customer_billing WHERE company = ?"
      : "SELECT id, company, billing_email, plan FROM customer_billing ORDER BY id";
    const rows = company
      ? billingDb.prepare(sql).all(company)
      : billingDb.prepare(sql).all();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ count: rows.length, rows }, null, 2),
        },
      ],
    };
  },
);

export default server;
