"""
Per-tool authorization middleware for MCP requests.

This module provides a deny-first authorization middleware that intercepts
tool calls before they reach the MCP server, enabling fine-grained access
control over which tools an agent is permitted to invoke.
"""

from collections.abc import Awaitable, Callable
from typing import Any

from mcp.types import CallToolResult, TextContent

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
    the call reaches the MCP server. Evaluates the call against an allowlist,
    denylist, and/or a custom async authorizer function.

    Authorization order:
      1. Denylist check — if the tool is in ``denied_tools``, deny immediately.
      2. Allowlist check — if ``allowed_tools`` is set and the tool is not in
         it, deny.
      3. Custom authorizer — if provided and it returns ``False``, deny.
      4. Otherwise, forward the call.

    A denied call returns a :class:`mcp.types.CallToolResult` with
    ``isError=True`` so the LLM can reason about the denial gracefully
    instead of seeing an unexpected exception.

    Args:
        allowed_tools: Explicit allowlist of tool names. When provided, any
            tool not on this list is denied. Pass ``None`` (default) to allow
            all tools not blocked by other checks.
        denied_tools: Explicit denylist of tool names. Takes precedence over
            ``allowed_tools``. Defaults to no denials.
        authorizer: Optional async callable with signature
            ``(tool_name: str, arguments: dict) -> bool``. Return ``True``
            to allow the call, ``False`` to deny it. Evaluated last, after
            the allowlist/denylist checks pass.

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

        # Custom authorizer backed by an external permission engine
        async def my_authorizer(tool_name: str, arguments: dict) -> bool:
            return await permission_engine.check(tool_name, arguments)

        client = MCPClient(
            config=config,
            middleware=[ToolAuthorizationMiddleware(authorizer=my_authorizer)],
        )
    """

    def __init__(
        self,
        allowed_tools: list[str] | None = None,
        denied_tools: list[str] | None = None,
        authorizer: Callable[[str, dict[str, Any]], Awaitable[bool]] | None = None,
    ) -> None:
        self._allowed: frozenset[str] | None = frozenset(allowed_tools) if allowed_tools is not None else None
        self._denied: frozenset[str] = frozenset(denied_tools or [])
        self._authorizer = authorizer

    async def on_call_tool(self, context: MiddlewareContext[Any], call_next: NextFunctionT) -> CallToolResult:
        tool_name: str = context.params.name
        arguments: dict[str, Any] = context.params.arguments or {}

        # 1. Denylist takes unconditional precedence.
        if tool_name in self._denied:
            return _denied_result(tool_name)

        # 2. Allowlist: if set, only listed tools are permitted.
        if self._allowed is not None and tool_name not in self._allowed:
            return _denied_result(tool_name)

        # 3. Custom authorizer for dynamic / external policy evaluation.
        if self._authorizer is not None and not await self._authorizer(tool_name, arguments):
            return _denied_result(tool_name)

        return await call_next(context)
