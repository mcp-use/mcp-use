import re
from collections.abc import Callable, Coroutine
from typing import Any

from mcp.types import Prompt, Resource, Tool

from ..connectors.base import BaseConnector
from .base import BaseAdapter


def _sanitize_for_tool_name(name: str) -> str:
    """Sanitizes a string to be a valid tool name for Anthropic."""
    # OpenAI tool names can only contain a-z, A-Z, 0-9, and underscores, and must be 64 characters or less.
    return re.sub(r"[^a-zA-Z0-9_]+", "_", name).strip("_")[:64]


class AnthropicMCPAdapter(BaseAdapter):
    def __init__(self, disallowed_tools: list[str] | None = None) -> None:
        """Initialize a new Anthropic adapter.

        Args:
            disallowed_tools: list of tool names that should not be available.
        """
        super().__init__(disallowed_tools)
        # This map stores the actual async function to call for each tool.
        self.tool_executors: dict[str, Callable[..., Coroutine[Any, Any, Any]]] = {}

    def _convert_tool(self, mcp_tool: Tool, connector: BaseConnector) -> dict[str, Any]:
        """Convert an MCP tool to the Anthropic tool format."""
        if mcp_tool.name in self.disallowed_tools:
            return None

        self.tool_executors[mcp_tool.name] = lambda **kwargs: connector.call_tool(mcp_tool.name, kwargs)

        fixed_schema = self.fix_schema(mcp_tool.inputSchema)
        return {"name": mcp_tool.name, "description": mcp_tool.description, "input_schema": fixed_schema}

    def _convert_resource(self, mcp_resource: Resource, connector: BaseConnector) -> dict[str, Any]:
        """Convert an MCP resource to a readable tool in OpenAI format."""
        pass

    def _convert_prompt(self, mcp_prompt: Prompt, connector: BaseConnector) -> dict[str, Any]:
        """Convert an MCP prompt to a usable tool in OpenAI format."""
        pass
