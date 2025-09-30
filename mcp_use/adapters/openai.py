from typing import Any

from mcp.types import Prompt, Resource, Tool

from ..connectors.base import BaseConnector
from .base import BaseAdapter


class OpenAIMCPAdapter(BaseAdapter):
    def __init__(self, disallowed_tools: list[str] | None = None) -> None:
        """Initialize a new OpenAI adapter.

        Args:
            disallowed_tools: list of tool names that should not be available.
        """
        super().__init__(disallowed_tools)
        self.tool_to_connector_map: dict[str, BaseConnector] = {}

    def _convert_tool(self, mcp_tool: Tool, connector: BaseConnector) -> dict[str, Any]:
        """Convert an MCP tool to the OpenAI tool format."""
        self.tool_to_connector_map[mcp_tool.name] = connector

        fixed_schema = self.fix_schema(mcp_tool.inputSchema)
        return {
            "type": "function",
            "function": {
                "name": mcp_tool.name,
                "description": mcp_tool.description,
                "parameters": fixed_schema,
            },
        }

    def _convert_resource(self, mcp_resource: Resource, connector: BaseConnector) -> dict[str, Any]:
        """Convert an MCP resource to a readable tool in OpenAI format."""
        # This part is not implemented yet.
        # You would create a tool that calls `connector.read_resource`.
        return None

    def _convert_prompt(self, mcp_prompt: Prompt, connector: BaseConnector) -> dict[str, Any]:
        """Convert an MCP prompt to a usable tool in OpenAI format."""
        # This part is not implemented yet.
        # You would create a tool that calls `connector.get_prompt`.
        return None
