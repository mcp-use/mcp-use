"""
Code Mode Connector - Meta MCP server for code execution.

This connector provides code execution capabilities as if they were
MCP tools, allowing seamless integration with existing adapter logic.
"""

import json
from typing import TYPE_CHECKING, Any

from mcp.types import CallToolResult, TextContent, Tool

from mcp_use.client.connectors.base import BaseConnector

if TYPE_CHECKING:
    from mcp_use.client.client import MCPClient


class CodeModeConnector(BaseConnector):
    """Meta connector that provides code execution as MCP tools.

    This connector doesn't connect to an external MCP server. Instead,
    it provides built-in tools for code execution and tool discovery.
    """

    def __init__(self, client: "MCPClient") -> None:
        """Initialize the code mode connector.

        Args:
            client: The MCPClient instance (for execute_code and search_tools)
        """
        super().__init__()
        self.client = client
        self._connected = True  # Always "connected" since it's internal
        self._initialized = True  # Always initialized since it's internal
        # Initialize tools eagerly since they're static
        self._tools = self._create_tools_list()

    async def connect(self) -> None:
        """Connect is a no-op for code mode connector."""
        self._connected = True

    async def disconnect(self) -> None:
        """Disconnect is a no-op for code mode connector."""
        self._connected = False

    def _create_tools_list(self) -> list[Tool]:
        """Create the static list of code mode tools.

        Returns:
            List of Tool objects for execute_code and search_tools
        """
        return [
            Tool(
                name="execute_code",
                description=(
                    "Execute Python code with access to MCP tools. "
                    "This is the PRIMARY way to interact with MCP servers in code mode. "
                    "Write Python code that discovers tools using search_tools(), "
                    "calls tools as async functions (e.g., await github.get_pull_request(...)), "
                    "processes data efficiently, and returns results. "
                    "Use 'await' for async operations and 'return' to return values. "
                    "Available in code: search_tools(), __tool_namespaces, and server.tool_name() functions."
                ),
                inputSchema={
                    "type": "object",
                    "properties": {
                        "code": {
                            "type": "string",
                            "description": (
                                "Python code to execute with access to MCP tools. "
                                "Use 'await' for async operations. Use 'return' to return a value. "
                                "Available: search_tools(), server.tool_name(), __tool_namespaces"
                            ),
                        },
                        "timeout": {"type": "number", "description": "Execution timeout in seconds", "default": 30.0},
                    },
                    "required": ["code"],
                },
            ),
            Tool(
                name="search_tools",
                description=(
                    "Search and discover available MCP tools across all servers. "
                    "Use this to find out what tools are available before writing code. "
                    "Returns tool information including names, descriptions, and schemas. "
                    "Can filter by query and control detail level."
                ),
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query to filter tools by name or description",
                            "default": "",
                        },
                        "detail_level": {
                            "type": "string",
                            "description": "Detail level: 'names', 'descriptions', or 'full'",
                            "enum": ["names", "descriptions", "full"],
                            "default": "full",
                        },
                    },
                },
            ),
        ]

    async def list_tools(self) -> list[Tool]:
        """List available code mode tools.

        Returns:
            List of Tool objects for execute_code and search_tools
        """
        return self._tools

    async def call_tool(
        self, tool_name: str, arguments: dict[str, Any], read_timeout_seconds: Any = None
    ) -> CallToolResult:
        """Call a code mode tool.

        Args:
            tool_name: Name of the tool (execute_code or search_tools)
            arguments: Tool arguments
            read_timeout_seconds: Ignored for code mode (uses timeout in arguments)

        Returns:
            CallToolResult with properly formatted content
        """
        if tool_name == "execute_code":
            code = arguments.get("code", "")
            timeout = arguments.get("timeout", 30.0)
            result = await self.client.execute_code(code, timeout)
            # Return as MCP CallToolResult
            return CallToolResult(content=[TextContent(type="text", text=json.dumps(result))])

        elif tool_name == "search_tools":
            query = arguments.get("query", "")
            detail_level = arguments.get("detail_level", "full")
            result = await self.client.search_tools(query, detail_level)
            # Return as MCP CallToolResult
            return CallToolResult(content=[TextContent(type="text", text=json.dumps(result))])

        else:
            raise ValueError(f"Unknown code mode tool: {tool_name}")

    async def list_resources(self) -> list:
        """Code mode connector has no resources."""
        return []

    async def list_prompts(self) -> list:
        """Code mode connector has no prompts."""
        return []

    async def read_resource(self, uri: str) -> Any:
        """Code mode connector has no resources."""
        raise NotImplementedError("Code mode connector does not support resources")

    async def get_prompt(self, name: str, arguments: dict[str, str] | None = None) -> Any:
        """Code mode connector has no prompts."""
        raise NotImplementedError("Code mode connector does not support prompts")

    @property
    def public_identifier(self) -> str:
        """Get the identifier for the connector."""
        return "code_mode:internal"

    @property
    def tools(self) -> list[Tool]:
        """Get cached tools (override BaseConnector property).

        Code mode connector tools are always initialized, so we can return them directly.
        """
        return self._tools

    def __str__(self) -> str:
        return self.public_identifier
