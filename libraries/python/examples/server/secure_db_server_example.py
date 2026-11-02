"""Self-contained Secure Analytical Database MCP Server Example for mcp-use.

This example demonstrates building a production-grade, 4-layer sandboxed analytical database
MCP server using `mcp-use`. It is designed to be self-contained in a single file suitable for
inclusion in `mcp-use/libraries/python/examples/server/secure_db_server_example.py`.

Key Features Showcased:
1. Layer 1: Hybrid RBAC Middleware + BearerAuthProvider supporting tokens and fallback.
2. Layer 2: Deterministic AST SQL Validator with sqlglot (zero LLM token consumption).
3. Layer 3: Interruptible In-Memory DuckDB Sandbox with C++ resource limits and watchdog.
4. Layer 4: Structured Output Telemetry & in-memory audit ring buffer.
5. Full MCP Primitives: Tools (with ToolAnnotations & Context streaming), Resources, and Prompts.

Usage:
    # 1. Install dependencies
    pip install "mcp-use>=1.3.0" "duckdb>=1.1.0" "sqlglot>=25.0.0"

    # 2. Run the server
    python secure_db_server_example.py

    # 3. Connect via MCP Inspector or Claude Desktop
    npx @modelcontextprotocol/inspector http://localhost:8000/mcp
"""

from __future__ import annotations

import json
import os
import sys

# Windows console UTF-8 fix for Rich / mcp-use unicode startup characters (e.g. \u2713 checkmark)
if sys.platform == "win32":
    os.environ["PYTHONIOENCODING"] = "utf-8"
    os.environ["PYTHONUTF8"] = "1"
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Point mcp-use inspector to pinned working CDN version with web bundle
os.environ.setdefault(
    "INSPECTOR_CDN_BASE_URL",
    "https://unpkg.com/@mcp-use/inspector@1.0.0/dist/web",
)

import threading
import time
import uuid
from collections import deque
from contextvars import ContextVar
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal

import duckdb
import sqlglot
from mcp.server.lowlevel.server import request_ctx
from mcp.types import CallToolRequestParams, PaginatedRequestParams, ToolAnnotations
from mcp_use.server import Context, MCPServer
from mcp_use.server.auth import AccessToken, BearerAuthProvider, get_access_token
from mcp_use.server.auth.dependencies import set_access_token
from mcp_use.server.middleware import CallNext, Middleware, ServerMiddlewareContext
from pydantic import BaseModel, Field
from sqlglot import exp
from sqlglot.errors import ParseError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


# =============================================================================
# Layer 1: RBAC Roles & Middleware
# =============================================================================


class Role(StrEnum):
    PUBLIC_VIEWER = "public_viewer"
    ANALYST = "analyst"
    ADMIN = "admin"


ROLE_ALLOWED_TOOLS: dict[Role, set[str]] = {
    Role.PUBLIC_VIEWER: {"whoami", "list_tables", "describe_table", "verify_query_safety"},
    Role.ANALYST: {"whoami", "list_tables", "describe_table", "verify_query_safety", "execute_analytical_sql"},
    Role.ADMIN: {
        "whoami",
        "list_tables",
        "describe_table",
        "verify_query_safety",
        "execute_analytical_sql",
        "get_security_audit_log",
    },
}

ADMIN_ONLY_TABLES: frozenset[str] = frozenset({"api_keys", "security_incidents"})
ALL_KNOWN_TABLES: frozenset[str] = frozenset(
    {"organizations", "mcp_servers", "tool_invocations", "subscriptions", "api_keys", "security_incidents"}
)
RESTRICTED_PII_COLUMNS: frozenset[str] = frozenset(
    {"billing_email", "stripe_customer_id", "webhook_secret", "client_ip", "key_hash", "raw_token_prefix"}
)
PII_COLUMNS_BY_TABLE: dict[str, frozenset[str]] = {
    "organizations": frozenset({"billing_email", "stripe_customer_id"}),
    "mcp_servers": frozenset({"webhook_secret"}),
    "tool_invocations": frozenset({"client_ip"}),
    "subscriptions": frozenset({"stripe_customer_id"}),
    "api_keys": frozenset({"key_hash", "raw_token_prefix"}),
    "security_incidents": frozenset(),
}
SAFE_COLUMNS_BY_TABLE: dict[str, tuple[str, ...]] = {
    "organizations": ("org_id", "org_name", "plan_tier", "mrr_usd", "region", "created_at"),
    "mcp_servers": (
        "server_id",
        "org_id",
        "server_name",
        "runtime",
        "transport",
        "status",
        "memory_mb",
        "avg_cold_start_ms",
        "deployed_at",
    ),
    "tool_invocations": (
        "invocation_id",
        "server_id",
        "org_id",
        "tool_name",
        "status",
        "latency_ms",
        "tokens_saved",
        "invoked_at",
    ),
    "subscriptions": (
        "subscription_id",
        "org_id",
        "plan_tier",
        "monthly_quota_calls",
        "used_calls",
        "status",
        "renews_at",
    ),
    "api_keys": ("key_id", "org_id", "scope_role", "created_at", "last_used_at"),
    "security_incidents": ("incident_id", "org_id", "role", "attack_vector", "blocked_sql", "detected_at"),
}


class CallerPrincipal(BaseModel):
    subject: str = "anonymous-viewer"
    email: str = "viewer@demo.local"
    role: Role = Role.PUBLIC_VIEWER
    scopes: list[str] = Field(default_factory=lambda: ["schema:read"])
    authenticated_via: str = "default_fallback"


_current_principal: ContextVar[CallerPrincipal] = ContextVar(
    "current_principal",
    default=CallerPrincipal(),
)


def get_current_principal() -> CallerPrincipal:
    return _current_principal.get()


def set_current_principal(p: CallerPrincipal) -> None:
    _current_principal.set(p)


def _get_token_registry() -> dict[str, CallerPrincipal]:
    viewer_token = os.environ.get("MCP_VIEWER_TOKEN", "token-viewer-demo")
    analyst_token = os.environ.get("MCP_ANALYST_TOKEN", "token-analyst-demo")
    admin_token = os.environ.get("MCP_ADMIN_TOKEN", "token-admin-demo")

    return {
        viewer_token: CallerPrincipal(
            subject="usr_viewer_01",
            email="viewer@demo.com",
            role=Role.PUBLIC_VIEWER,
            scopes=["schema:read"],
            authenticated_via="bearer_token",
        ),
        analyst_token: CallerPrincipal(
            subject="usr_analyst_01",
            email="analyst@demo.com",
            role=Role.ANALYST,
            scopes=["schema:read", "sql:execute_bounded"],
            authenticated_via="bearer_token",
        ),
        admin_token: CallerPrincipal(
            subject="usr_admin_01",
            email="admin@demo.com",
            role=Role.ADMIN,
            scopes=["schema:read", "sql:execute_bounded", "pii:read", "audit:read"],
            authenticated_via="bearer_token",
        ),
    }


def warn_if_default_tokens_in_use() -> list[str]:
    viewer_token = os.environ.get("MCP_VIEWER_TOKEN", "token-viewer-demo")
    analyst_token = os.environ.get("MCP_ANALYST_TOKEN", "token-analyst-demo")
    admin_token = os.environ.get("MCP_ADMIN_TOKEN", "token-admin-demo")

    active_defaults = []
    if viewer_token == "token-viewer-demo":
        active_defaults.append("token-viewer-demo (MCP_VIEWER_TOKEN)")
    if analyst_token == "token-analyst-demo":
        active_defaults.append("token-analyst-demo (MCP_ANALYST_TOKEN)")
    if admin_token == "token-admin-demo":
        active_defaults.append("token-admin-demo (MCP_ADMIN_TOKEN)")

    if active_defaults:
        print(
            f"SECURITY WARNING: Default demo authentication tokens are active ({', '.join(active_defaults)}). "
            "These hardcoded demo tokens are for testing only and must never be used in production. "
            "Override with MCP_VIEWER_TOKEN, MCP_ANALYST_TOKEN, and MCP_ADMIN_TOKEN."
        )
    return active_defaults


def resolve_token(raw: str | None) -> CallerPrincipal | None:
    if not raw:
        return None
    token = raw.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    return _get_token_registry().get(token)


class ExampleBearerAuthProvider(BearerAuthProvider):
    async def verify_token(self, token: str) -> AccessToken | None:
        p = resolve_token(token)
        if not p:
            return None
        return AccessToken(
            token=token,
            claims={"sub": p.subject, "email": p.email, "role": p.role.value},
            scopes=p.scopes,
        )


class HybridHTTPAuthMiddleware(BaseHTTPMiddleware):
    """HTTP middleware supporting both Bearer/x-api-key tokens and Hybrid unauthenticated fallback."""

    def __init__(
        self,
        app: Any,
        auth_provider: ExampleBearerAuthProvider,
        strict_auth: bool = False,
    ) -> None:
        super().__init__(app)
        self.auth_provider = auth_provider
        self.strict_auth = strict_auth

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        mcp_path = "/mcp"
        if not request.url.path.startswith(mcp_path) or request.method == "OPTIONS":
            set_access_token(None)
            return await call_next(request)

        auth_header = request.headers.get("authorization")
        api_key_header = request.headers.get("x-api-key")
        raw_token: str | None = None

        if auth_header:
            if auth_header.lower().startswith("bearer "):
                raw_token = auth_header[7:].strip()
            else:
                raw_token = auth_header.strip()
        elif api_key_header:
            raw_token = api_key_header.strip()

        if raw_token:
            access_token = await self.auth_provider.verify_token(raw_token)
            if access_token is None:
                set_access_token(None)
                return JSONResponse(
                    {
                        "error": "invalid_token",
                        "error_description": (
                            "Invalid authentication token. Valid demo tokens: "
                            "'token-viewer-demo', 'token-analyst-demo', 'token-admin-demo'."
                        ),
                    },
                    status_code=401,
                    headers={"WWW-Authenticate": "Bearer"},
                )
            set_access_token(access_token)
            request.state.access_token = access_token
            try:
                return await call_next(request)
            finally:
                set_access_token(None)

        env_strict = os.environ.get("MCP_STRICT_AUTH", "false").lower() in ("1", "true", "yes")
        if self.strict_auth or env_strict:
            set_access_token(None)
            return JSONResponse(
                {
                    "error": "unauthorized",
                    "error_description": "Authentication required (strict mode enabled).",
                },
                status_code=401,
                headers={"WWW-Authenticate": "Bearer"},
            )

        set_access_token(None)
        return await call_next(request)


class RBACMiddleware(Middleware):
    def __init__(self, audit_logger: AuditLogger | None = None, strict_auth: bool = False) -> None:
        self.audit_logger = audit_logger
        self.strict_auth = strict_auth

    def _extract_headers(self, context: ServerMiddlewareContext[Any]) -> dict[str, str]:
        raw_headers: dict[str, str] = {}
        if context.headers:
            raw_headers.update({k.lower(): v for k, v in context.headers.items()})
        try:
            req_ctx = request_ctx.get()
            if req_ctx and getattr(req_ctx, "request", None) is not None:
                req_headers = getattr(req_ctx.request, "headers", None)
                if req_headers:
                    for k, v in req_headers.items():
                        raw_headers.setdefault(str(k).lower(), str(v))
        except LookupError:
            pass
        return raw_headers

    def _resolve(self, context: ServerMiddlewareContext[Any]) -> CallerPrincipal:
        token = get_access_token()
        if token:
            try:
                role = Role(str(token.claims.get("role", "public_viewer")))
            except ValueError:
                role = Role.PUBLIC_VIEWER
            return CallerPrincipal(
                subject=str(token.claims.get("sub", "token-user")),
                email=str(token.claims.get("email", "user@demo.com")),
                role=role,
                scopes=list(token.scopes),
                authenticated_via="mcp_use_token",
            )

        headers = self._extract_headers(context)
        explicit = headers.get("authorization") or headers.get("x-api-key")
        if explicit:
            principal = resolve_token(explicit)
            if not principal:
                raise PermissionError("Invalid token. Use 'token-viewer-demo', 'token-analyst-demo', or 'token-admin-demo'.")
            return principal

        env_token = os.environ.get("MCP_DEFAULT_TOKEN")
        if env_token and (p := resolve_token(env_token)):
            return p

        env_strict = os.environ.get("MCP_STRICT_AUTH", "false").lower() in ("1", "true", "yes")
        if self.strict_auth or env_strict:
            raise PermissionError("Authentication required in strict mode.")

        return CallerPrincipal(
            subject="default-viewer",
            email="viewer@demo.local",
            role=Role.PUBLIC_VIEWER,
            scopes=["schema:read"],
            authenticated_via="fallback",
        )

    async def on_request(
        self,
        context: ServerMiddlewareContext[Any],
        call_next: CallNext[Any, Any],
    ) -> Any:
        principal = self._resolve(context)
        set_current_principal(principal)
        return await call_next(context)

    async def on_list_tools(
        self,
        context: ServerMiddlewareContext[PaginatedRequestParams | None],
        call_next: CallNext[PaginatedRequestParams | None, Any],
    ) -> Any:
        principal = self._resolve(context)
        set_current_principal(principal)
        allowed = ROLE_ALLOWED_TOOLS[principal.role]

        response = await call_next(context)
        if hasattr(response, "root") and hasattr(response.root, "tools") and isinstance(response.root.tools, list):
            response.root.tools = [t for t in response.root.tools if getattr(t, "name", None) in allowed]
            return response
        if isinstance(response, list):
            return [t for t in response if getattr(t, "name", None) in allowed]
        if hasattr(response, "tools") and isinstance(response.tools, list):
            response.tools = [t for t in response.tools if getattr(t, "name", None) in allowed]
        return response

    async def on_call_tool(
        self,
        context: ServerMiddlewareContext[CallToolRequestParams],
        call_next: CallNext[CallToolRequestParams, Any],
    ) -> Any:
        principal = self._resolve(context)
        set_current_principal(principal)

        tool_name = context.message.name
        allowed = ROLE_ALLOWED_TOOLS[principal.role]
        if tool_name not in allowed:
            msg = f"Access denied: role '{principal.role.value}' cannot call tool '{tool_name}'."
            if self.audit_logger:
                self.audit_logger.record(principal.role, tool_name, "BLOCKED_RBAC", "RBAC_UNAUTHORIZED", msg)
            raise PermissionError(msg)

        return await call_next(context)


# =============================================================================
# Layer 2: Deterministic AST Validator (sqlglot)
# =============================================================================


class SQLSecurityError(ValueError):
    def __init__(self, message: str, violation_category: str = "AST_POLICY_VIOLATION") -> None:
        super().__init__(message)
        self.violation_category = violation_category


FORBIDDEN_FUNCS = frozenset(
    {
        "read_csv",
        "read_csv_auto",
        "read_parquet",
        "parquet_scan",
        "read_json",
        "read_text",
        "glob",
        "st_read",
        "repeat",
        "sleep",
    }
)
FORBIDDEN_NODES = (
    exp.Drop,
    exp.Delete,
    exp.Update,
    exp.Insert,
    exp.Create,
    exp.Alter,
    exp.Pragma,
    exp.Command,
    exp.Copy,
    exp.Attach,
    exp.Detach,
)


class SQLValidator:
    def validate_and_sanitize(
        self,
        sql: str,
        role: Role = Role.ANALYST,
        limit: int = 100,
    ) -> tuple[str, list[str]]:
        if not sql or not sql.strip():
            raise SQLSecurityError("Query cannot be empty.", "EMPTY_QUERY")

        cleaned = sql.strip()

        # Token-based comment and semicolon checking
        try:
            tokens = sqlglot.tokenize(cleaned, read="duckdb")
        except Exception as exc:
            raise SQLSecurityError(f"Malformed SQL syntax: {exc}", "SYNTAX_ERROR") from exc

        if not tokens or any(t.comments for t in tokens):
            raise SQLSecurityError("SQL comments ('--' or '/* */') are forbidden.", "COMMENT_SMUGGLING")

        semicolon_indices = [i for i, t in enumerate(tokens) if t.token_type == sqlglot.TokenType.SEMICOLON]
        if any(idx < len(tokens) - 1 for idx in semicolon_indices):
            raise SQLSecurityError("Multi-statement SQL queries are strictly forbidden.", "MULTI_STATEMENT_SMUGGLING")

        try:
            statements = sqlglot.parse(cleaned, read="duckdb", error_level=sqlglot.ErrorLevel.RAISE)
        except ParseError as exc:
            raise SQLSecurityError(f"SQL syntax error: {exc}", "SYNTAX_ERROR") from exc

        if len(statements) != 1 or not isinstance(statements[0], (exp.Select, exp.Union, exp.Intersect, exp.Except)):
            raise SQLSecurityError("Only read-only SELECT queries are allowed.", "FORBIDDEN_STATEMENT_TYPE")

        ast = statements[0]
        for node in ast.walk():
            if getattr(node, "comments", None):
                raise SQLSecurityError("SQL comments are forbidden.", "COMMENT_SMUGGLING")
            if isinstance(node, FORBIDDEN_NODES):
                raise SQLSecurityError(f"Mutating operation '{type(node).__name__}' blocked.", "MUTATING_OPERATION")
            if isinstance(node, exp.Func):
                name = node.name.lower() if isinstance(node, exp.Anonymous) else node.sql_name().lower()
                if name in FORBIDDEN_FUNCS or name.startswith("read_"):
                    raise SQLSecurityError(f"Function '{name}()' is forbidden.", "EXTERNAL_ACCESS_OR_DOS")

        # Join Complexity & Cartesian Tautology Prevention
        joins = list(ast.find_all(exp.Join))
        if len(joins) > 4:
            raise SQLSecurityError("Exceeded maximum of 4 joins.", "DOS_COMPLEXITY_EXCEEDED")

        for join in joins:
            join_kind = (join.kind or "").upper()
            on_clause = join.args.get("on")
            has_using = bool(join.args.get("using"))
            if join_kind == "CROSS" or (not on_clause and not has_using):
                raise SQLSecurityError("Unconstrained CROSS JOIN or Cartesian comma-join is forbidden.", "CARTESIAN_JOIN_DOS")
            if on_clause:
                if not list(on_clause.find_all(exp.Column)):
                    raise SQLSecurityError("Degenerate Cartesian JOIN with literal tautology (e.g. ON 1=1) is forbidden.", "CARTESIAN_JOIN_DOS")
                for eq in on_clause.find_all(exp.EQ, exp.GTE, exp.LTE):
                    if eq.left == eq.right:
                        raise SQLSecurityError("Degenerate Cartesian JOIN with self-comparison tautology (e.g. ON x=x) is forbidden.", "CARTESIAN_JOIN_DOS")

        # Table & Column RBAC checks
        cte_aliases = {cte.alias_or_name.lower() for cte in ast.find_all(exp.CTE) if cte.alias_or_name}
        tables = [t.name.lower() for t in ast.find_all(exp.Table) if t.name and t.name.lower() not in cte_aliases]
        for t in tables:
            if t not in ALL_KNOWN_TABLES:
                raise SQLSecurityError(f"Unknown table '{t}'.", "UNKNOWN_TABLE")
            if role != Role.ADMIN and t in ADMIN_ONLY_TABLES:
                raise SQLSecurityError(f"Table '{t}' requires admin role.", "RBAC_TABLE_RESTRICTED")

        for col in ast.find_all(exp.Column):
            cname = col.name.lower()
            if role != Role.ADMIN and cname in RESTRICTED_PII_COLUMNS:
                raise SQLSecurityError(f"Column '{cname}' contains restricted PII.", "RBAC_PII_RESTRICTED")

        # Wildcard Star check on PII tables
        if role != Role.ADMIN:
            for star in ast.find_all(exp.Star):
                if not isinstance(star.parent, exp.Count):
                    for t in tables:
                        if PII_COLUMNS_BY_TABLE.get(t):
                            raise SQLSecurityError(f"SELECT * blocked on PII table '{t}' for analyst.", "RBAC_WILDCARD_PII")

        for lim_node in ast.find_all(exp.Limit):
            if lim_node.expression is not None:
                try:
                    val = int(str(lim_node.expression.this))
                    if val > 1000:
                        lim_node.set("expression", exp.Literal.number(1000))
                except (ValueError, TypeError):
                    pass

        clamped = max(1, min(limit, 1000))
        ast = ast.limit(clamped, copy=True)
        return ast.sql(dialect="duckdb"), sorted(set(tables))


# =============================================================================
# Layers 3 & 4: DuckDB Engine & Telemetry
# =============================================================================


class QueryTimeoutError(TimeoutError):
    pass


class AuditLogger:
    def __init__(self) -> None:
        self._entries: deque[dict[str, Any]] = deque(maxlen=200)
        self._lock = threading.Lock()

    def record(
        self,
        role: Role,
        action: str,
        status: str,
        category: str | None = None,
        reason: str | None = None,
        ms: float = 0.0,
    ) -> None:
        with self._lock:
            self._entries.appendleft(
                {
                    "id": uuid.uuid4().hex[:8],
                    "time": datetime.now(UTC).isoformat(),
                    "role": role.value,
                    "action": action,
                    "status": status,
                    "category": category,
                    "reason": reason,
                    "execution_ms": round(ms, 2),
                }
            )

    def get_recent(self, limit: int = 20, status_filter: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            items = list(self._entries)
        if status_filter and status_filter.upper() != "ALL":
            items = [e for e in items if e["status"].upper() == status_filter.upper()]
        return items[:limit]


class SecureDBEngine:
    def __init__(self, timeout_seconds: float = 10.0) -> None:
        self.timeout_seconds = timeout_seconds
        self.conn = duckdb.connect(":memory:")
        self.validator = SQLValidator()
        self.audit = AuditLogger()
        self._lock = threading.Lock()
        self._seed()
        self._harden()

    def _seed(self) -> None:
        self.conn.execute(
            """
            CREATE TABLE organizations (
                org_id VARCHAR PRIMARY KEY, org_name VARCHAR, plan_tier VARCHAR,
                mrr_usd DOUBLE, region VARCHAR, created_at TIMESTAMP,
                billing_email VARCHAR, stripe_customer_id VARCHAR
            );
            INSERT INTO organizations VALUES
                ('org_01', 'Acme Robotics AI', 'enterprise', 4800.0, 'eu-central-1', '2026-01-15 09:00:00', 'finance@acme.ai', 'cus_111'),
                ('org_02', 'Vanguard Quant Labs', 'enterprise', 6200.0, 'us-east-1', '2026-02-02 14:30:00', 'ops@vanguard.io', 'cus_222'),
                ('org_03', 'Helios Biotech', 'scale', 1490.0, 'eu-west-1', '2026-02-19 11:15:00', 'billing@helios.bio', 'cus_333');

            CREATE TABLE mcp_servers (
                server_id VARCHAR PRIMARY KEY, org_id VARCHAR, server_name VARCHAR,
                runtime VARCHAR, transport VARCHAR, status VARCHAR, memory_mb INTEGER,
                avg_cold_start_ms DOUBLE, deployed_at TIMESTAMP, webhook_secret VARCHAR
            );
            INSERT INTO mcp_servers VALUES
                ('srv_101', 'org_01', 'robotics-telemetry', 'python-uv', 'streamable-http', 'healthy', 1024, 310.5, '2026-09-01 10:00:00', 'whsec_secret1'),
                ('srv_102', 'org_02', 'market-tick-analytics', 'python-uv', 'streamable-http', 'healthy', 2048, 190.2, '2026-09-15 09:45:00', 'whsec_secret2'),
                ('srv_103', 'org_03', 'alphafold-bridge', 'dockerfile', 'streamable-http', 'healthy', 4096, 620.4, '2026-09-25 08:00:00', 'whsec_secret3');

            CREATE TABLE tool_invocations (
                invocation_id VARCHAR PRIMARY KEY, server_id VARCHAR, org_id VARCHAR, tool_name VARCHAR,
                status VARCHAR, latency_ms DOUBLE, tokens_saved INTEGER, invoked_at TIMESTAMP, client_ip VARCHAR
            );
            INSERT INTO tool_invocations VALUES
                ('inv_1', 'srv_101', 'org_01', 'query_joint_states', 'success', 42.5, 1850, '2026-10-25 10:01:00', '192.168.1.10'),
                ('inv_2', 'srv_102', 'org_02', 'execute_analytical_sql', 'success', 21.0, 4200, '2026-10-25 11:10:00', '10.0.0.5'),
                ('inv_3', 'srv_103', 'org_03', 'align_binding_pocket', 'success', 310.2, 7900, '2026-10-25 12:00:00', '172.16.0.4');

            CREATE TABLE subscriptions (
                subscription_id VARCHAR PRIMARY KEY, org_id VARCHAR, plan_tier VARCHAR,
                monthly_quota_calls INTEGER, used_calls INTEGER, status VARCHAR, renews_at TIMESTAMP,
                stripe_customer_id VARCHAR
            );
            INSERT INTO subscriptions VALUES
                ('sub_1', 'org_01', 'enterprise', 5000000, 3100000, 'active', '2026-11-15 00:00:00', 'cus_111'),
                ('sub_2', 'org_02', 'enterprise', 10000000, 8900000, 'active', '2026-11-02 00:00:00', 'cus_222');

            CREATE TABLE api_keys (
                key_id VARCHAR PRIMARY KEY, org_id VARCHAR, scope_role VARCHAR,
                key_hash VARCHAR, raw_token_prefix VARCHAR, created_at TIMESTAMP, last_used_at TIMESTAMP
            );
            INSERT INTO api_keys VALUES
                ('key_901', 'org_01', 'admin', 'sha256:abcd', 'mnf_live_abcd', '2026-01-16 10:00:00', '2026-10-26 08:30:00'),
                ('key_902', 'org_02', 'analyst', 'sha256:efgh', 'mnf_live_efgh', '2026-02-03 11:00:00', '2026-10-26 09:00:00');

            CREATE TABLE security_incidents (
                incident_id VARCHAR PRIMARY KEY, org_id VARCHAR, role VARCHAR,
                attack_vector VARCHAR, blocked_sql VARCHAR, detected_at TIMESTAMP
            );
            INSERT INTO security_incidents VALUES
                ('inc_501', 'org_01', 'analyst', 'COMMENT_SMUGGLING', 'SELECT * FROM orgs -- bypass', '2026-10-25 10:00:00');
            """
        )

    def _harden(self) -> None:
        self.conn.execute("SET memory_limit = '512MB';")
        self.conn.execute("SET threads = 2;")
        self.conn.execute("SET enable_external_access = false;")
        self.conn.execute("SET lock_configuration = true;")

    def list_accessible_tables(self, role: Role) -> list[dict[str, Any]]:
        tables = sorted(ALL_KNOWN_TABLES if role == Role.ADMIN else (ALL_KNOWN_TABLES - ADMIN_ONLY_TABLES))
        catalog = []
        with self._lock:
            for t in tables:
                cnt = self.conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                pii_cols = sorted(PII_COLUMNS_BY_TABLE.get(t, frozenset()))
                catalog.append(
                    {
                        "table_name": t,
                        "row_count": cnt,
                        "access_tier": "admin_only" if t in ADMIN_ONLY_TABLES else "analyst_and_admin",
                        "safe_columns": list(SAFE_COLUMNS_BY_TABLE[t]),
                        "restricted_pii_columns": pii_cols if role == Role.ADMIN else f"{len(pii_cols)} restricted column(s)",
                    }
                )
        return catalog

    def describe_table_schema(self, table_name: str, role: Role) -> dict[str, Any]:
        t = table_name.strip().lower()
        if t not in ALL_KNOWN_TABLES:
            raise ValueError(f"Unknown table '{table_name}'.")
        if role != Role.ADMIN and t in ADMIN_ONLY_TABLES:
            self.audit.record(role, "describe_table", "BLOCKED_RBAC", "RBAC_TABLE_RESTRICTED", f"Table '{t}' is restricted.")
            raise PermissionError(f"Access denied: table '{t}' requires admin role.")

        with self._lock:
            info = self.conn.execute(f"PRAGMA table_info('{t}')").fetchall()
        pii_set = PII_COLUMNS_BY_TABLE.get(t, frozenset())
        cols = []
        for cid, col_name, col_type, notnull, dflt, pk in info:
            is_pii = col_name.lower() in pii_set
            cols.append(
                {
                    "column_name": col_name,
                    "data_type": col_type,
                    "primary_key": bool(pk),
                    "access_policy": "ADMIN_ONLY_PII" if is_pii else "ANALYST_SAFE",
                    "queryable_by_current_role": (role == Role.ADMIN or not is_pii),
                }
            )
        return {
            "table_name": t,
            "caller_role": role.value,
            "select_star_allowed": (role == Role.ADMIN or not pii_set),
            "columns": cols,
        }

    def query(self, sql: str, role: Role, limit: int = 100, timeout: float | None = None) -> dict[str, Any]:
        if role == Role.PUBLIC_VIEWER:
            raise PermissionError("Role 'public_viewer' cannot execute queries.")

        t0 = time.perf_counter()
        try:
            sanitized, tables = self.validator.validate_and_sanitize(sql, role=role, limit=limit)
        except SQLSecurityError as exc:
            self.audit.record(role, "execute_analytical_sql", "BLOCKED_AST", exc.violation_category, str(exc))
            raise

        eff_timeout = timeout or self.timeout_seconds
        timed_out = threading.Event()

        def _interrupt():
            timed_out.set()
            try:
                self.conn.interrupt()
            except Exception:
                pass

        timer = threading.Timer(eff_timeout, _interrupt)
        timer.daemon = True

        with self._lock:
            timer.start()
            try:
                rel = self.conn.execute(sanitized)
                cols = [desc[0] for desc in (rel.description or [])]
                raw_rows = rel.fetchall()
            except Exception as exc:
                ms = (time.perf_counter() - t0) * 1000.0
                if timed_out.is_set() or "interrupt" in str(exc).lower():
                    self.audit.record(role, "execute_analytical_sql", "TIMEOUT", "EXECUTION_TIMEOUT", str(exc), ms=ms)
                    raise QueryTimeoutError(f"Query aborted after {eff_timeout}s.") from exc
                self.audit.record(role, "execute_analytical_sql", "ERROR", "RUNTIME_ERROR", str(exc), ms=ms)
                raise
            finally:
                timer.cancel()

        ms = (time.perf_counter() - t0) * 1000.0
        rows = [dict(zip(cols, r, strict=False)) for r in raw_rows]
        self.audit.record(role, "execute_analytical_sql", "ALLOWED", ms=ms)
        return {
            "status": "success",
            "role": role.value,
            "sanitized_sql": sanitized,
            "tables_accessed": tables,
            "row_count": len(rows),
            "columns": cols,
            "rows": rows,
            "execution_ms": round(ms, 2),
        }


# =============================================================================
# MCPServer Initialization & Endpoints
# =============================================================================

TableNameLiteral = Literal[
    "organizations",
    "mcp_servers",
    "tool_invocations",
    "subscriptions",
    "api_keys",
    "security_incidents",
]

class SecureDBExampleServer(MCPServer):
    def __init__(self, *args: Any, hybrid_auth_provider: ExampleBearerAuthProvider | None = None, strict_auth: bool = False, **kwargs: Any) -> None:
        self._hybrid_auth_provider = hybrid_auth_provider or ExampleBearerAuthProvider()
        self._strict_auth = strict_auth
        super().__init__(*args, **kwargs)

    def streamable_http_app(self) -> Any:
        from starlette.responses import RedirectResponse

        app = super().streamable_http_app()

        async def _root_redirect(_request: Any) -> Any:
            return RedirectResponse(url="/inspector", status_code=307)

        app.add_route("/", _root_redirect, methods=["GET"])
        app.add_middleware(
            HybridHTTPAuthMiddleware,
            auth_provider=self._hybrid_auth_provider,
            strict_auth=self._strict_auth,
        )
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
            allow_headers=["*"],
            expose_headers=["WWW-Authenticate", "mcp-session-id", "mcp-protocol-version"],
        )
        return app


engine = SecureDBEngine()
rbac = RBACMiddleware(audit_logger=engine.audit)
auth_provider = ExampleBearerAuthProvider()

server = SecureDBExampleServer(
    name="mcp-secure-db-demo",
    version="1.0.0",
    instructions="4-layer sandboxed analytical database MCP server with AST validation & DuckDB limits.",
    middleware=[rbac],
    hybrid_auth_provider=auth_provider,
    debug=True,
)


@server.tool(name="whoami", annotations=ToolAnnotations(readOnlyHint=True))
async def whoami(ctx: Context | None = None) -> dict[str, Any]:
    """Inspect active caller principal and RBAC privileges."""
    p = get_current_principal()
    if ctx:
        try:
            await ctx.info(f"Resolved principal {p.subject} ({p.role.value})")
        except Exception:
            pass
    return p.model_dump()


@server.tool(name="list_tables", annotations=ToolAnnotations(readOnlyHint=True))
async def list_tables() -> list[dict[str, Any]]:
    """List tables accessible to caller."""
    p = get_current_principal()
    return engine.list_accessible_tables(role=p.role)


@server.tool(name="describe_table", annotations=ToolAnnotations(readOnlyHint=True))
async def describe_table(table_name: TableNameLiteral) -> dict[str, Any]:
    """Retrieve column schema, data types, and access policy for a table."""
    p = get_current_principal()
    return engine.describe_table_schema(table_name=table_name, role=p.role)


@server.tool(name="verify_query_safety", annotations=ToolAnnotations(readOnlyHint=True))
async def verify_query_safety(sql: str, requested_limit: int = 100) -> dict[str, Any]:
    """Dry-run validation of SQL query without executing it."""
    p = get_current_principal()
    try:
        sanitized, tables = engine.validator.validate_and_sanitize(sql, role=p.role, limit=requested_limit)
        return {"is_safe": True, "sanitized_sql": sanitized, "tables": tables}
    except SQLSecurityError as exc:
        return {"is_safe": False, "category": exc.violation_category, "reason": str(exc)}


@server.tool(name="execute_analytical_sql")
async def execute_analytical_sql(sql: str, limit: int = 100, ctx: Context | None = None) -> dict[str, Any]:
    """Execute bounded read-only analytical query inside sandbox."""
    p = get_current_principal()
    if ctx:
        try:
            await ctx.info(f"Executing query under role {p.role.value}")
        except Exception:
            pass
    return engine.query(sql, role=p.role, limit=limit)


@server.tool(name="get_security_audit_log", annotations=ToolAnnotations(readOnlyHint=True))
async def get_security_audit_log(limit: int = 25, status_filter: str = "ALL") -> list[dict[str, Any]]:
    """Retrieve recent security audit entries (admin only)."""
    p = get_current_principal()
    if p.role != Role.ADMIN:
        raise PermissionError("Admin role required.")
    return engine.audit.get_recent(limit=limit, status_filter=status_filter)


@server.resource("schema://catalog", mime_type="application/json")
def resource_catalog() -> str:
    """Catalog of accessible analytical tables."""
    p = get_current_principal()
    return json.dumps(engine.list_accessible_tables(role=p.role), indent=2)


@server.resource("schema://tables/{table_name}", mime_type="application/json")
def resource_table_schema(table_name: str) -> str:
    """Detailed schema specification for a specific table."""
    p = get_current_principal()
    return json.dumps(engine.describe_table_schema(table_name=table_name, role=p.role), indent=2)


@server.resource("policy://security-rules", mime_type="text/markdown")
def resource_security_rules() -> str:
    """4-Layer Defense-in-Depth Security Policy specification."""
    return (
        "# 4-Layer Defense-in-Depth Policy\n"
        "1. Layer 1: RBAC Middleware with BearerAuth token resolution.\n"
        "2. Layer 2: sqlglot AST Validator (defense in depth; blocks DDL, SSRF, DoS joins, PII).\n"
        "3. Layer 3: Sandboxed DuckDB Engine (primary defense; memory limits & conn.interrupt() watchdog).\n"
        "4. Layer 4: Structured telemetry & in-memory audit ring buffer (lost on restart).\n"
    )


@server.prompt(name="executive_analytics")
def prompt_executive_analytics(focus: Literal["mrr_growth", "server_reliability"] = "mrr_growth") -> str:
    """Template for AI executive analytics briefing."""
    return f"Analyze Manufact telemetry focusing on '{focus}'. Use `execute_analytical_sql` safely."


@server.prompt(name="red_team_security_audit")
def prompt_red_team_audit(target_vector: Literal["external_file_ssrf", "cartesian_dos"] = "external_file_ssrf") -> str:
    """Adversarial test prompt to evaluate database sandbox defenses."""
    return f"Evaluate sandbox resilience against '{target_vector}'. Call `verify_query_safety` first."


server._wrap_handlers_with_middleware()


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    print("=" * 60)
    print("Starting Self-Contained MCP Secure DB Server Example")
    print("Demo Tokens (DEV ONLY): token-viewer-demo, token-analyst-demo, token-admin-demo")
    print("=" * 60)
    warn_if_default_tokens_in_use()
    server.run(transport="streamable-http", host=host, port=port)
