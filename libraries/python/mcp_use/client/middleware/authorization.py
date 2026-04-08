"""
Per-tool authorization middleware for MCP requests.

This module provides a deny-first authorization middleware that intercepts
tool calls before they reach the MCP server, enabling fine-grained access
control over which tools an agent is permitted to invoke.
"""

import time
from collections.abc import Awaitable, Callable
from typing import Any

from mcp.types import CallToolResult, ListToolsResult, TextContent

from mcp_use.logging import logger

from .middleware import Middleware, MiddlewareContext, NextFunctionT


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
    ``list_tools`` so that unauthorized tools are never visible to the LLM.

    Authorization order for tool calls:
      1. Denylist check — if the tool is in ``denied_tools``, deny immediately.
      2. Allowlist check — if ``allowed_tools`` is set and the tool is not in
         it, deny.
      3. Custom authorizer — if provided and it returns ``False``, deny.
      4. Otherwise, forward the call.

    Every decision (allow or deny) is logged via the ``mcp_use`` logger so
    an audit trail is always available.

    A denied call returns a :class:`mcp.types.CallToolResult` with
    ``isError=True`` so the LLM can reason about the denial gracefully
    instead of seeing an unexpected exception.

    Args:
        allowed_tools: Explicit allowlist of tool names. When provided, any
            tool not on this list is denied. Pass ``None`` (default) to allow
            all tools not blocked by other checks.
        denied_tools: Explicit denylist of tool names. Takes precedence over
            ``allowed_tools``. Defaults to no denials.
        agent_context: Arbitrary identity/metadata dict (e.g. agent ID, OAuth
            token, role) forwarded to the ``authorizer`` as its third argument.
            Useful for building identity-aware permission checks without
            coupling the middleware to a specific auth system.
        authorizer: Optional async callable with signature
            ``(tool_name: str, arguments: dict, agent_context: dict) -> bool``.
            Return ``True`` to allow the call, ``False`` to deny it. Evaluated
            last, after the allowlist/denylist checks pass.

    Example::

        # Research agent: only allowed to search
        client = MCPClient(
            config=config,
            middleware=[ToolAuthorizationMiddleware(allowed_tools=["search_docs"])],
        )

        # Content agent: cannot touch destructive tools
        client = MCPClient(
            config=config,
            middleware=[
                ToolAuthorizationMiddleware(denied_tools=["delete_note", "deploy_prod"])
            ],
        )

        # Identity-aware authorizer backed by an external permission engine
        async def my_authorizer(tool_name: str, arguments: dict, agent_context: dict) -> bool:
            token = agent_context.get("token")
            return await permission_engine.check(token, tool_name, arguments)

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
        authorizer: Callable[[str, dict[str, Any], dict[str, Any]], Awaitable[bool]] | None = None,
    ) -> None:
        self._allowed: frozenset[str] | None = frozenset(allowed_tools) if allowed_tools is not None else None
        self._denied: frozenset[str] = frozenset(denied_tools or [])
        self._agent_context: dict[str, Any] = agent_context or {}
        self._authorizer = authorizer

    def _is_tool_allowed_by_static_rules(self, tool_name: str) -> bool:
        """Check allowlist/denylist rules only (no async authorizer)."""
        if tool_name in self._denied:
            return False
        if self._allowed is not None and tool_name not in self._allowed:
            return False
        return True

    async def on_list_tools(self, context: MiddlewareContext[Any], call_next: NextFunctionT) -> ListToolsResult:
        """Filter the tool list so denied tools are never visible to the LLM."""
        result: ListToolsResult = await call_next(context)
        if not result.tools:
            return result

        filtered = [tool for tool in result.tools if self._is_tool_allowed_by_static_rules(tool.name)]
        removed = len(result.tools) - len(filtered)
        if removed:
            logger.debug(f"[ToolAuthorizationMiddleware] Filtered {removed} unauthorized tool(s) from list_tools")

        return ListToolsResult(tools=filtered)

    async def on_call_tool(self, context: MiddlewareContext[Any], call_next: NextFunctionT) -> CallToolResult:
        tool_name: str = context.params.name
        arguments: dict[str, Any] = context.params.arguments or {}
        timestamp = time.time()

        # 1. Denylist takes unconditional precedence.
        if tool_name in self._denied:
            logger.info(f"[ToolAuthorizationMiddleware] DENIED tool='{tool_name}' reason=denylist ts={timestamp:.3f}")
            return _denied_result(tool_name)

        # 2. Allowlist: if set, only listed tools are permitted.
        if self._allowed is not None and tool_name not in self._allowed:
            logger.info(
                f"[ToolAuthorizationMiddleware] DENIED tool='{tool_name}' reason=not_in_allowlist ts={timestamp:.3f}"
            )
            return _denied_result(tool_name)

        # 3. Custom authorizer for dynamic / external policy evaluation.
        if self._authorizer is not None and not await self._authorizer(tool_name, arguments, self._agent_context):
            logger.info(f"[ToolAuthorizationMiddleware] DENIED tool='{tool_name}' reason=authorizer ts={timestamp:.3f}")
            return _denied_result(tool_name)

        logger.debug(f"[ToolAuthorizationMiddleware] ALLOWED tool='{tool_name}' ts={timestamp:.3f}")
        return await call_next(context)
