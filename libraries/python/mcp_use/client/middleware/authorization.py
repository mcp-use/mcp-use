"""
Per-tool authorization middleware for MCP requests.

This module provides a deny-first authorization middleware that intercepts
tool calls before they reach the MCP server, enabling fine-grained access
control over which tools an agent is permitted to invoke.

The middleware is fail-safe: any unexpected error while evaluating the
custom authorizer results in a deny decision, never an allow.
"""

from collections.abc import Awaitable, Callable
from typing import Any, TypeAlias

from mcp.types import CallToolResult, ListToolsResult, TextContent

from mcp_use.logging import logger

from .middleware import Middleware, MiddlewareContext, NextFunctionT

#: Signature for a custom authorizer callable.
#:
#: Args:
#:     tool_name: The name of the tool being invoked.
#:     arguments: The arguments the LLM supplied for the call.
#:     agent_context: Identity/metadata dict passed to the middleware at
#:         construction time (e.g. agent ID, OAuth token, role).
#:
#: Returns:
#:     ``True`` to allow the call, ``False`` to deny it.
AuthorizerFn: TypeAlias = Callable[[str, dict[str, Any], dict[str, Any]], Awaitable[bool]]


def _denied_result(tool_name: str) -> CallToolResult:
    """Return a CallToolResult indicating the tool call was denied."""
    return CallToolResult(
        content=[TextContent(type="text", text=f"Tool '{tool_name}' is not authorized for this agent.")],
        isError=True,
    )


class ToolAuthorizationMiddleware(Middleware):
    """Deny-first per-tool authorization middleware.

    Intercepts tool calls after the LLM decides to invoke a tool but before
    the call reaches the MCP server. Also filters the tool list returned by
    ``list_tools`` so that statically-disallowed tools are never visible to
    the LLM (the async ``authorizer`` is not consulted here because it may
    need per-call arguments to decide).

    Authorization order for tool calls:
      1. Denylist check — if the tool is in ``denied_tools``, deny immediately.
      2. Allowlist check — if ``allowed_tools`` is set and the tool is not in
         it, deny.
      3. Custom authorizer — if provided and it returns ``False`` (or raises),
         deny.
      4. Otherwise, forward the call.

    Every decision (allow or deny) is logged via the ``mcp_use`` logger with
    the request ID and connection ID so the audit trail can be correlated
    with other middleware output.

    This middleware is **fail-safe**: if the ``authorizer`` raises an
    exception, the call is denied rather than allowed. Exceptions are
    logged at error level so the root cause is visible.

    A denied call returns a :class:`mcp.types.CallToolResult` with
    ``isError=True`` so the LLM can reason about the denial gracefully
    instead of seeing an unexpected exception.

    Args:
        allowed_tools: Explicit allowlist of tool names. When provided, any
            tool not on this list is denied. Pass ``None`` (default) to allow
            all tools not blocked by other checks. An empty list denies
            everything.
        denied_tools: Explicit denylist of tool names. Takes precedence over
            ``allowed_tools``. Defaults to no denials.
        agent_context: Arbitrary identity/metadata dict (e.g. agent ID, OAuth
            token, role) forwarded to the ``authorizer`` as its third argument.
            Useful for building identity-aware permission checks without
            coupling the middleware to a specific auth system.
        authorizer: Optional async callable matching :data:`AuthorizerFn`.
            Evaluated last, after the allowlist/denylist checks pass.

    Example::

        # Research agent: only allowed to search
        client = MCPClient(
            config=config,
            middleware=[ToolAuthorizationMiddleware(allowed_tools=["search_docs"])],
        )

        # Identity-aware authorizer backed by an external permission engine
        async def my_authorizer(tool_name, arguments, agent_context):
            return await permission_engine.check(
                agent_context["token"], tool_name, arguments
            )

        client = MCPClient(
            config=config,
            middleware=[
                ToolAuthorizationMiddleware(
                    agent_context={"agent_id": "research-1", "token": "..."},
                    authorizer=my_authorizer,
                )
            ],
        )
    """

    def __init__(
        self,
        allowed_tools: list[str] | None = None,
        denied_tools: list[str] | None = None,
        agent_context: dict[str, Any] | None = None,
        authorizer: AuthorizerFn | None = None,
    ) -> None:
        self._allowed: frozenset[str] | None = frozenset(allowed_tools) if allowed_tools is not None else None
        self._denied: frozenset[str] = frozenset(denied_tools or [])
        self._agent_context: dict[str, Any] = agent_context or {}
        self._authorizer: AuthorizerFn | None = authorizer

    def _static_deny_reason(self, tool_name: str) -> str | None:
        """Return the reason a tool is denied by static rules, or ``None`` if allowed.

        This is the single source of truth for allowlist/denylist evaluation,
        used by both :meth:`on_call_tool` (for logging) and
        :meth:`on_list_tools` (for filtering).
        """
        if tool_name in self._denied:
            return "denylist"
        if self._allowed is not None and tool_name not in self._allowed:
            return "not_in_allowlist"
        return None

    def _is_tool_allowed_by_static_rules(self, tool_name: str) -> bool:
        """Check allowlist/denylist rules only (no async authorizer)."""
        return self._static_deny_reason(tool_name) is None

    def _log_decision(self, context: MiddlewareContext[Any], decision: str, tool_name: str, reason: str) -> None:
        """Emit an audit log entry for an allow/deny decision."""
        level = logger.debug if decision == "ALLOWED" else logger.info
        level(
            f"[{context.id}] {context.connection_id} ToolAuthorizationMiddleware "
            f"{decision} tool='{tool_name}' reason={reason}"
        )

    async def on_list_tools(self, context: MiddlewareContext[Any], call_next: NextFunctionT) -> ListToolsResult:
        """Filter the tool list using static rules only.

        The async ``authorizer`` is intentionally not consulted here because
        it may need per-call arguments and side-effect-free evaluation is not
        guaranteed.
        """
        result: ListToolsResult = await call_next(context)
        filtered = [tool for tool in result.tools if self._is_tool_allowed_by_static_rules(tool.name)]
        removed = len(result.tools) - len(filtered)
        if removed:
            logger.debug(
                f"[{context.id}] {context.connection_id} ToolAuthorizationMiddleware "
                f"filtered {removed} unauthorized tool(s) from list_tools"
            )
        result.tools = filtered
        return result

    async def on_call_tool(self, context: MiddlewareContext[Any], call_next: NextFunctionT) -> CallToolResult:
        tool_name: str = context.params.name
        arguments: dict[str, Any] = context.params.arguments or {}

        # 1. & 2. Static rules (denylist, then allowlist).
        deny_reason = self._static_deny_reason(tool_name)
        if deny_reason is not None:
            self._log_decision(context, "DENIED", tool_name, deny_reason)
            return _denied_result(tool_name)

        # 3. Custom authorizer for dynamic / external policy evaluation.
        #    Fail-safe: any exception results in a deny, not an allow.
        if self._authorizer is not None:
            try:
                allowed = await self._authorizer(tool_name, arguments, self._agent_context)
            except Exception as exc:
                logger.error(
                    f"[{context.id}] {context.connection_id} ToolAuthorizationMiddleware "
                    f"authorizer raised for tool='{tool_name}': {exc!r} — denying (fail-safe)"
                )
                return _denied_result(tool_name)

            if not allowed:
                self._log_decision(context, "DENIED", tool_name, "authorizer")
                return _denied_result(tool_name)

        self._log_decision(context, "ALLOWED", tool_name, "ok")
        return await call_next(context)
