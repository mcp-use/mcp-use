import re
from collections.abc import Callable, Coroutine
from typing import Any

from mcp.types import Prompt, Resource, Tool

from mcp_use.agents.adapters.base import BaseAdapter
from mcp_use.client.connectors.base import BaseConnector


def _sanitize_for_tool_name(name: str) -> str:
    """Sanitizes a string to be a valid tool name for Anthropic."""
    # Anthropic tool names can only contain a-z, A-Z, 0-9, and underscores,
    # and must be 64 characters or less.
    return re.sub(r"[^a-zA-Z0-9_]+", "_", name).strip("_")[:64]


class AnthropicMCPAdapter(BaseAdapter[dict[str, Any]]):
    framework: str = "anthropic"

    def __init__(self, disallowed_tools: list[str] | None = None) -> None:
        """Initialize a new Anthropic adapter.

        Args:
            disallowed_tools: list of tool names that should not be available.
        """
        super().__init__(disallowed_tools=disallowed_tools)
        # This map stores the actual async function to call for each tool.
        self.tool_executors: dict[str, Callable[..., Coroutine[Any, Any, Any]]] = {}

        self._connector_tool_map: dict[BaseConnector, list[dict[str, Any]]] = {}
        self._connector_resource_map: dict[BaseConnector, list[dict[str, Any]]] = {}
        self._connector_prompt_map: dict[BaseConnector, list[dict[str, Any]]] = {}

        self.tools: list[dict[str, Any]] = []
        self.resources: list[dict[str, Any]] = []
        self.prompts: list[dict[str, Any]] = []

    def _convert_tool(self, mcp_tool: Tool, connector: BaseConnector) -> dict[str, Any] | None:
        """Convert an MCP tool to the Anthropic tool format."""
        if mcp_tool.name in self.disallowed_tools:
            return None

        self.tool_executors[mcp_tool.name] = lambda connector=connector, name=mcp_tool.name, **kwargs: (
            connector.call_tool(name, kwargs)
        )

        fixed_schema = self.fix_schema(mcp_tool.inputSchema)
        return {"name": mcp_tool.name, "description": mcp_tool.description, "input_schema": fixed_schema}

    def _convert_resource(self, mcp_resource: Resource, connector: BaseConnector) -> dict[str, Any] | None:
        """Convert an MCP resource to a readable tool in Anthropic format."""
        tool_name = _sanitize_for_tool_name(f"resource_{mcp_resource.name}")

        if tool_name in self.disallowed_tools:
            return None

        self.tool_executors[tool_name] = lambda connector=connector, uri=mcp_resource.uri, **kwargs: (
            connector.read_resource(uri)
        )

        return {
            "name": tool_name,
            "description": mcp_resource.description,
            "input_schema": {"type": "object", "properties": {}},
        }

    def _convert_prompt(self, mcp_prompt: Prompt, connector: BaseConnector) -> dict[str, Any] | None:
        """Convert an MCP prompt to a usable tool in Anthropic format."""
        if mcp_prompt.name in self.disallowed_tools:
            return None

        self.tool_executors[mcp_prompt.name] = lambda connector=connector, name=mcp_prompt.name, **kwargs: (
            connector.get_prompt(name, kwargs)
        )

        properties = {}
        required_args = []
        if mcp_prompt.arguments:
            for arg in mcp_prompt.arguments:
                prop = {"type": "string"}
                if arg.description:
                    prop["description"] = arg.description
                properties[arg.name] = prop
                if arg.required:
                    required_args.append(arg.name)
        parameters_schema = {"type": "object", "properties": properties}
        if required_args:
            parameters_schema["required"] = required_args

        return {
            "name": mcp_prompt.name,
            "description": mcp_prompt.description,
            "input_schema": parameters_schema,
        }
