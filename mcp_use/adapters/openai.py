import re
from collections.abc import Callable, Coroutine
from typing import Any

from mcp.types import Prompt, Resource, Tool

from ..connectors.base import BaseConnector
from .base import BaseAdapter


def _sanitize_for_tool_name(name: str) -> str:
    """Sanitizes a string to be a valid tool name for OpenAI."""
    # OpenAI tool names can only contain a-z, A-Z, 0-9, and underscores, and must be 64 characters or less.
    return re.sub(r"[^a-zA-Z0-9_]+", "_", name).strip("_")[:64]


class OpenAIMCPAdapter(BaseAdapter):
    def __init__(self, disallowed_tools: list[str] | None = None) -> None:
        """Initialize a new OpenAI adapter.

        Args:
            disallowed_tools: list of tool names that should not be available.
        """
        super().__init__(disallowed_tools)
        # This map stores the actual async function to call for each tool.
        self.tool_executors: dict[str, Callable[..., Coroutine[Any, Any, Any]]] = {}

    def _convert_tool(self, mcp_tool: Tool, connector: BaseConnector) -> dict[str, Any]:
        """Convert an MCP tool to the OpenAI tool format."""
        if mcp_tool.name in self.disallowed_tools:
            return None

        self.tool_executors[mcp_tool.name] = lambda **kwargs: connector.call_tool(mcp_tool.name, kwargs)

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
        # Sanitize the name to be a valid function name for OpenAI
        tool_name = _sanitize_for_tool_name(f"resource_{mcp_resource.uri}")

        if tool_name in self.disallowed_tools:
            return None

        self.tool_executors[tool_name] = lambda **kwargs: connector.read_resource(mcp_resource.uri)

        mcp_resource_desc = mcp_resource.description
        return {
            "type": "function",
            "function": {
                "name": tool_name,
                "description": mcp_resource_desc,
                # They take no arguments
                "parameters": {"type": "object", "properties": {}},
            },
        }

    def _convert_prompt(self, mcp_prompt: Prompt, connector: BaseConnector) -> dict[str, Any]:
        """Convert an MCP prompt to a usable tool in OpenAI format."""
        if mcp_prompt.name in self.disallowed_tools:
            return None

        self.tool_executors[mcp_prompt.name] = lambda **kwargs: connector.get_prompt(mcp_prompt.name, kwargs)

        # Preparing JSON schema for prompt arguments
        properties = {}
        required_args = []
        python_to_json_schema_type = {
            str: "string",
            int: "integer",
            float: "number",
            bool: "boolean",
            list: "array",
            dict: "object",
        }
        if mcp_prompt.arguments:
            for arg in mcp_prompt.arguments:
                param_type = getattr(arg, "type", str)
                json_type = python_to_json_schema_type.get(param_type, "string")
                properties[arg.name] = {"type": json_type, "description": arg.description}
                if arg.required:
                    required_args.append(arg.name)

        parameters_schema = {"type": "object", "properties": properties}
        if required_args:
            parameters_schema["required"] = required_args

        return {
            "type": "function",
            "function": {
                "name": mcp_prompt.name,
                "description": mcp_prompt.description,
                "parameters": parameters_schema,
            },
        }
