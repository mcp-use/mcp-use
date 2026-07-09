"""Base class and shared utilities for MCP code executors.

Code mode lets an agent interact with MCP tools by writing Python code that runs
with the tools exposed as async functions, instead of issuing one tool call at a
time (see https://www.anthropic.com/engineering/code-execution-with-mcp).

This module defines the executor contract. A concrete executor decides *where*
the agent code runs:

- :class:`mcp_use.client.executors.vm.VMCodeExecutor` runs it in-process. Fast,
  zero dependencies, but **not a security boundary** (see that class' docstring).
- A sandboxed executor (e.g. an E2B cloud sandbox) runs it in an isolated
  environment and is the recommended path for untrusted code. The pluggable seam
  below exists so such an executor can be dropped in without touching the client.

The design mirrors the TypeScript implementation in
``libraries/typescript/packages/mcp-use/src/client/executors`` (base/vm/e2b).
"""

import inspect
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any, TypedDict

from mcp_use.logging import logger

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from mcp_use.client.client import MCPClient


class ExecutionResult(TypedDict):
    """Structured result of executing a block of agent code.

    Attributes:
        result: The value returned by the executed code (``None`` if it returned nothing).
        logs: Captured ``print`` output, one entry per line.
        error: Error message if execution failed, otherwise ``None``.
        execution_time: Wall-clock execution time in seconds.
    """

    result: Any
    logs: list[str]
    error: str | None
    execution_time: float


class BaseCodeExecutor(ABC):
    """Abstract base class for code executors.

    Provides the shared machinery every executor needs: lazily connecting MCP
    servers, discovering their tools as callable namespaces, and building the
    ``search_tools`` helper exposed to executed code. Subclasses implement
    :meth:`execute` (and optionally override :meth:`cleanup`).
    """

    def __init__(self, client: "MCPClient") -> None:
        """Initialize the executor.

        Args:
            client: The :class:`MCPClient` whose sessions and tools the executed
                code can reach.
        """
        self.client = client
        self._tool_cache: dict[str, dict[str, Any]] = {}

    @abstractmethod
    async def execute(self, code: str, timeout: float = 30.0) -> ExecutionResult:
        """Execute ``code`` with access to MCP tools.

        Implementations own timeout enforcement: ``MCPClient.execute_code`` passes
        ``timeout`` straight through, so a custom executor must honor it (the
        built-in :class:`~mcp_use.client.executors.vm.VMCodeExecutor` does).

        Args:
            code: Python code to execute.
            timeout: Execution timeout in seconds.

        Returns:
            An :class:`ExecutionResult`.
        """

    async def cleanup(self) -> None:
        """Release any resources held by the executor.

        Default implementation is a no-op. Executors that own external resources
        (remote sandboxes, subprocesses) should override this.
        """
        return None

    async def _ensure_servers_connected(self) -> None:
        """Connect any configured-but-unconnected MCP servers (lazy connection)."""
        # We check client.sessions directly to see internal state.
        configured_servers = set(self.client.get_server_names())
        active_sessions = set(self.client.sessions.keys())

        # If any configured server is missing from sessions, trigger connection.
        if not configured_servers.issubset(active_sessions):
            logger.debug("Connecting to configured servers for code execution...")
            await self.client.create_all_sessions()

    def _create_tool_wrapper(self, server_name: str, tool_name: str, tool_schema: Any) -> Any:
        """Create a wrapper function for an MCP tool.

        Args:
            server_name: Name of the MCP server.
            tool_name: Name of the tool.
            tool_schema: Tool schema with description and input schema.

        Returns:
            Async function that calls the MCP tool.
        """

        async def tool_wrapper(**kwargs):
            """Dynamically generated tool wrapper."""
            import json

            session = self.client.get_session(server_name)
            result = await session.call_tool(tool_name, kwargs)

            # Extract content from result
            if hasattr(result, "content") and result.content:
                # Return first content item's text if available
                if len(result.content) > 0:
                    content_item = result.content[0]
                    if hasattr(content_item, "text"):
                        text = content_item.text
                        # Try to parse as JSON if possible
                        try:
                            return json.loads(text)
                        except (json.JSONDecodeError, ValueError):
                            # Return as string if not valid JSON
                            return text
                    return content_item
                return result.content

            return result

        # Set function metadata
        tool_wrapper.__name__ = tool_name
        if hasattr(tool_schema, "description"):
            tool_wrapper.__doc__ = tool_schema.description

        return tool_wrapper

    async def _build_tool_namespaces(self) -> dict[str, Any]:
        """Build per-server namespace objects exposing tools as async functions.

        Returns:
            Mapping of server name to a namespace object whose attributes are the
            server's tool wrappers (e.g. ``github.get_pull_request(...)``).
        """
        tool_namespaces: dict[str, Any] = {}

        logger.debug(f"Building execution namespace from sessions: {list(self.client.sessions.keys())}")

        for server_name, session in self.client.sessions.items():
            # Get tools for this server
            try:
                tools = await session.list_tools()

                # Skip if no tools found
                if not tools:
                    continue

                # Create namespace object for this server
                server_namespace = type(server_name, (), {})()

                for tool in tools:
                    tool_name = tool.name
                    # Sanitize tool name to be a valid Python identifier
                    sanitized_name = self._sanitize_identifier(tool_name)

                    # Create wrapper function for this tool
                    wrapper = self._create_tool_wrapper(server_name, tool_name, tool)
                    setattr(server_namespace, sanitized_name, wrapper)
                    # Also keep original name if it's valid, just in case
                    if sanitized_name != tool_name and tool_name.isidentifier():
                        setattr(server_namespace, tool_name, wrapper)

                tool_namespaces[server_name] = server_namespace
                logger.debug(f"Added namespace '{server_name}' with {len(tools)} tools")

            except Exception as e:
                logger.error(f"Failed to load tools for server {server_name}: {e}")

        return tool_namespaces

    @staticmethod
    def _sanitize_identifier(tool_name: str) -> str:
        """Turn a tool name into a valid Python identifier."""
        import re

        sanitized_name = re.sub(r"[^a-zA-Z0-9_]", "_", tool_name)
        if not sanitized_name:
            return "_unnamed_tool"
        if not sanitized_name[0].isalpha() and sanitized_name[0] != "_":
            sanitized_name = f"_{sanitized_name}"
        return sanitized_name

    def create_search_tools_function(self):
        """Create the ``search_tools`` function exposed to executed code.

        Returns:
            Async function that searches available tools across all sessions.
        """

        async def search_tools(query: str = "", detail_level: str = "full") -> dict[str, Any]:
            """Search available MCP tools.

            Args:
                query: Search query to filter tools by name or description.
                detail_level: Level of detail to return ("names", "descriptions", "full").

            Returns:
                Dictionary with:
                - meta: Dictionary containing total_tools, namespaces, and result_count
                - results: List of tool information dictionaries matching the query
            """
            all_tools = []
            all_namespaces = set()
            query_lower = query.lower()

            # First pass: collect all tools and namespaces
            for server_name, session in self.client.sessions.items():
                try:
                    tools = await session.list_tools()
                    if tools:
                        all_namespaces.add(server_name)

                    for tool in tools:
                        # Build tool info based on detail level (before filtering)
                        if detail_level == "names":
                            tool_info = {
                                "name": tool.name,
                                "server": server_name,
                            }
                        elif detail_level == "descriptions":
                            tool_info = {
                                "name": tool.name,
                                "server": server_name,
                                "description": getattr(tool, "description", ""),
                            }
                        else:  # full
                            tool_info = {
                                "name": tool.name,
                                "server": server_name,
                                "description": getattr(tool, "description", ""),
                                "input_schema": getattr(tool, "inputSchema", {}),
                            }

                        all_tools.append(tool_info)

                except Exception as e:
                    logger.error(f"Failed to list tools for server {server_name}: {e}")

            # Filter by query if provided
            filtered_tools = all_tools
            if query:
                filtered_tools = []
                for tool_info in all_tools:
                    tool_name_match = query_lower in tool_info["name"].lower()
                    desc_match = query_lower in tool_info.get("description", "").lower()
                    server_match = query_lower in tool_info["server"].lower()
                    if tool_name_match or desc_match or server_match:
                        filtered_tools.append(tool_info)

            # Return metadata along with results
            return {
                "meta": {
                    "total_tools": len(all_tools),
                    "namespaces": sorted(list(all_namespaces)),
                    "result_count": len(filtered_tools),
                },
                "results": filtered_tools,
            }

        return search_tools


class FunctionCodeExecutor(BaseCodeExecutor):
    """Adapter that turns a user-supplied callable into a code executor.

    Lets callers plug in their own execution backend (e.g. a custom sandbox)
    without subclassing :class:`BaseCodeExecutor`. The callable receives
    ``(code, timeout)`` and must return (or await) an :class:`ExecutionResult`.

    The callable owns timeout enforcement. Note a *synchronous* callable runs
    inline on the event loop, so it must be quick or manage its own threading
    (e.g. ``asyncio.to_thread``); a blocking sync callable will stall the loop.
    """

    def __init__(self, client: "MCPClient", fn: "Callable[[str, float], ExecutionResult | Awaitable[ExecutionResult]]"):
        """Initialize the adapter.

        Args:
            client: The owning :class:`MCPClient`.
            fn: Callable invoked as ``fn(code, timeout)``; may be sync or async.
        """
        super().__init__(client)
        self._fn = fn

    async def execute(self, code: str, timeout: float = 30.0) -> "ExecutionResult":
        """Delegate execution to the wrapped callable."""
        result = self._fn(code, timeout)
        if inspect.isawaitable(result):
            return await result
        return result
