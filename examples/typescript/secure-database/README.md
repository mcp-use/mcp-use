# Secure Analytical Database Server

This example demonstrates how to build a **hardened, layered analytical database MCP server** using `mcp-use`.

Exposing database query tools to autonomous LLM agents introduces severe security risks: prompt-injected SQL mutations (`DROP`, `DELETE`), comment smuggling (`--`, `/*`), sensitive PII exfiltration, runaway Cartesian joins, and recursive CTE denial-of-service.

This server demonstrates a **four-layer defense-in-depth architecture** that allows safe analytical SQL queries while failing closed on any adversarial vector.

---

## Architecture at a Glance

```
┌────────────────────────────────────────────────────────────────────────┐
│  LAYER 1: Default-Deny RBAC & Wire Middleware                          │
│  - server.use("mcp:tools/list", ...) dynamically hides tools per role  │
│  - server.use("mcp:tools/call", ...) blocks unauthorized calls         │
├────────────────────────────────────────────────────────────────────────┤
│  LAYER 2: Local JavaScript AST Validator (node-sql-parser)             │
│  - 0 LLM token cost: validates SQL locally before touching database    │
│  - Blocks DDL/DML, multi-statement chains (;), and SQL comments (--)   │
│  - Rejects CROSS/NATURAL joins and tautological ON 1=1 conditions      │
│  - Injects default LIMIT 100, clamps max LIMIT to 1000                 │
├────────────────────────────────────────────────────────────────────────┤
│  LAYER 3: Worker-Thread SQLite Sandbox (node:worker_threads)           │
│  - Runs node:sqlite in an isolated Worker thread with V8 heap limits   │
│  - Hard PRAGMA query_only = ON and PRAGMA trusted_schema = OFF         │
│  - Compile-time setAuthorizer checks functions and base column reads   │
├────────────────────────────────────────────────────────────────────────┤
│  LAYER 4: Hard Execution Timeout & Untrusted Data Tagging              │
│  - Terminates worker thread via worker.terminate() on slow queries     │
│  - Respawns clean worker thread automatically with zero downtime       │
│  - Tags all query results with untrustedData: true                     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Authentication & Roles

Authentication is default-deny. Provide credentials via standard HTTP `Authorization: Bearer <token>` header, `X-API-Key: <token>` header, connection query parameter `?token=<token>`, or the per-call `token` tool argument:

| Token | Role | Capabilities |
| :--- | :--- | :--- |
| *(Missing or invalid)* | `unauthenticated` | Database tools fail closed unless a valid per-call `token` argument is provided |
| `token-viewer-demo` | `public_viewer` | Metadata discovery (`whoami`, `list_tables`, `describe_table`, `verify_query_safety`) |
| `token-analyst-demo` | `analyst` | Analytics (`execute_analytical_sql`) on business tables; sensitive PII column reads denied |
| `token-admin-demo` | `admin` | Full access, PII inspection, and audit log telemetry (`get_security_audit_log`) |

Credentials propagate uniformly across request context: header-authenticated clients do not need to repeat `token` in tool arguments, and clients using per-call arguments can discover callable tools in `tools/list`.

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

Connect using the official MCP Inspector:
```bash
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

---

## Example Queries

### 1. Safe Multi-Table Analytical Join (Analyst Role)
```json
{
  "query": "SELECT p.title, COUNT(o.id) as order_count, SUM(o.amount_usd) as total_revenue FROM products p JOIN orders o ON p.id = o.product_id GROUP BY p.title ORDER BY total_revenue DESC LIMIT 5;",
  "token": "token-analyst-demo"
}
```
**Result**: Executes successfully in `< 10ms` and returns clean aggregations tagged with `untrustedData: true`.

### 2. Adversarial DDL Injection (Blocked Closed by Layer 2)
```json
{
  "query": "DROP TABLE customers;",
  "token": "token-analyst-demo"
}
```
**Result**: `ASTValidationError: Disallowed SQL statement 'DROP'. Only read-only SELECT statements are permitted.`

### 3. Stacked / Multi-Statement Injection (Blocked Closed by Layer 2)
```json
{
  "query": "SELECT id FROM products; DROP TABLE customers;",
  "token": "token-analyst-demo"
}
```
**Result**: `ASTValidationError: Stacked/multi-statement queries (;) are prohibited.`

### 4. PII Exfiltration Attempt (Blocked Closed by Layer 2 & 3)
```json
{
  "query": "SELECT name, billing_email, stripe_customer_id FROM customers;",
  "token": "token-analyst-demo"
}
```
**Result**: `ASTValidationError: Access denied: sensitive PII column 'billing_email' requires admin privileges.`

### 5. Runaway Recursive CTE DoS (Terminated by Layer 4)
```json
{
  "query": "WITH RECURSIVE spin(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM spin WHERE n < 500000000) SELECT SUM(n) FROM spin;",
  "token": "token-analyst-demo"
}
```
**Result**: `QueryTimeout: Execution exceeded hard deadline of 3000ms; worker thread terminated.` The server automatically respawns a clean worker thread with zero event-loop starvation.
