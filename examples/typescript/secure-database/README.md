# Role-based SQLite Database Server

This example demonstrates how to build a **role-based analytical SQLite server** using `mcp-use` protocol middleware.

It highlights two key patterns:

- `server.use("mcp:tools/list", ...)` dynamically filters visible tools based on the caller's role.
- `server.use("mcp:tools/call", ...)` enforces role-to-tool permissions at the wire level before tool callbacks execute.
- In-memory SQLite databases (`node:sqlite`) with `PRAGMA query_only = ON` prevent mutations at the database engine level.

---

## Authentication & Roles

Authentication is resolved from the standard HTTP `Authorization: Bearer <token>` header:

| Header Token           | Role            | Visible Tools                                            | Capabilities                                                 |
| :--------------------- | :-------------- | :------------------------------------------------------- | :----------------------------------------------------------- |
| _(None / Invalid)_     | Unauthenticated | _(None)_                                                 | All tool calls are rejected (`Unauthorized`)                 |
| `Bearer token-viewer`  | `viewer`        | `list_tables`                                            | Read analytics schema metadata                               |
| `Bearer token-analyst` | `analyst`       | `list_tables`, `query_analytics`                         | Execute analytical SELECT queries on `products` and `orders` |
| `Bearer token-admin`   | `admin`         | `list_tables`, `query_analytics`, `get_customer_billing` | Full analytics plus parameterized customer billing lookup    |

Credentials never appear as tool arguments, keeping sensitive tokens out of the LLM context.

---

## Security Architecture

1. **Engine-Level Write Protection**: `PRAGMA query_only = ON;` is set at the SQLite engine level after seeding, preventing table mutations (`INSERT`, `UPDATE`, `DELETE`, `DROP`).
2. **Single-SELECT Guard**: `query_analytics` permits only a single `SELECT` statement and rejects comments (`--`, `/*`) and stacked queries (`;`), preventing toggling `PRAGMA query_only = OFF`.
3. **PII Separation**: Sensitive customer billing data lives in a separate in-memory database (`billingDb`) accessed only by the admin-gated `get_customer_billing` tool. An analyst running `SELECT *` on `analyticsDb` cannot read PII.

---

## Quickstart

```bash
# 1. Install dependencies
npm install

# 2. Typecheck
npm run typecheck

# 3. Start development server
npm run dev
```

Connect using the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

Add an `Authorization: Bearer token-analyst` header in the Inspector to explore analytical query tools.
