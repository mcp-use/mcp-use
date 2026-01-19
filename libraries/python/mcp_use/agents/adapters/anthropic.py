from typing import Any

from mcp.types import Prompt, Resource, Tool

from mcp_use.agents.adapters.base import BaseAdapter
from mcp_use.client.connectors.base import BaseConnector


class AnthropicMCPAdapter(BaseAdapter[dict[str, Any]]):
    """Adapter for converting MCP tools to Anthropic's tool format.

    This adapter uses the common utilities from BaseAdapter to minimize
    code duplication and ensure consistent behavior across adapters.
    """

    framework: str = "anthropic"

    def _init_executor_maps(self) -> None:
        """Initialize executor maps including Anthropic-specific tool_executors."""
        super()._init_executor_maps()
        # This map stores the actual async function to call for each tool
        self.tool_executors: dict[str, Any] = {}

    def _convert_tool(self, mcp_tool: Tool, connector: BaseConnector) -> dict[str, Any] | None:
        """Convert an MCP tool to the Anthropic tool format."""
        if not self._is_tool_allowed(mcp_tool.name):
            return None

        # Use base class executor creation
        self.tool_executors[mcp_tool.name] = self._create_tool_executor(connector, mcp_tool.name)

        return {
            "name": mcp_tool.name,
            "description": mcp_tool.description,
            "input_schema": self.fix_schema(mcp_tool.inputSchema),
        }

    def _convert_resource(self, mcp_resource: Resource, connector: BaseConnector) -> dict[str, Any] | None:
        """Convert an MCP resource to a readable tool in Anthropic format."""
        tool_name = self._get_resource_tool_name(mcp_resource)

        if not self._is_tool_allowed(tool_name):
            return None

        # Use base class executor creation
        self.tool_executors[tool_name] = self._create_resource_executor(connector, mcp_resource.uri)

        return {
            "name": tool_name,
            "description": mcp_resource.description,
            "input_schema": {"type": "object", "properties": {}},
        }

    def _convert_prompt(self, mcp_prompt: Prompt, connector: BaseConnector) -> dict[str, Any] | None:
        """Convert an MCP prompt to a usable tool in Anthropic format."""
        if not self._is_tool_allowed(mcp_prompt.name):
            return None

        # Use base class executor creation
        self.tool_executors[mcp_prompt.name] = self._create_prompt_executor(connector, mcp_prompt.name)

        # Use base class schema building
        parameters_schema = self._build_prompt_parameters_schema(mcp_prompt)

        return {
            "name": mcp_prompt.name,
            "description": mcp_prompt.description,
            "input_schema": parameters_schema,
        }
