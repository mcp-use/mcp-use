"""
React adapter for MCP tools.

This module provides utilities to convert MCP tools to a format suitable for the ReAct agent.
Unlike the LangChain adapter, this returns dictionaries that can be used directly by the ReAct agent.
"""

from typing import Any

from mcp.types import Prompt, Resource, Tool

from ..connectors.base import BaseConnector
from ..logging import logger
from .base import BaseAdapter


class ReactAdapter(BaseAdapter):
    """Adapter for converting MCP tools to ReAct agent format."""

    def __init__(
        self,
        disallowed_tools: list[str] | None = None,
        include_resources: bool = False,
        include_prompts: bool = False,
    ) -> None:
        """Initialize a new React adapter.

        Args:
            disallowed_tools: list of tool names that should not be available.
            include_resources: Whether to include resources as tools.
            include_prompts: Whether to include prompts as tools.
        """
        super().__init__(disallowed_tools)
        self.include_resources = include_resources
        self.include_prompts = include_prompts
        self._connector_tool_map: dict[BaseConnector, list[dict[str, Any]]] = {}

    def _convert_tool(self, mcp_tool: Tool, connector: BaseConnector) -> dict[str, Any]:
        """Convert an MCP tool to ReAct agent's tool format.

        Args:
            mcp_tool: The MCP tool to convert.
            connector: The connector that provides this tool.

        Returns:
            A dictionary containing tool information for the ReAct agent.
        """
        # Skip disallowed tools
        if mcp_tool.name in self.disallowed_tools:
            return None

        return {
            "name": mcp_tool.name,
            "session": connector.client_session,
            "schema": mcp_tool.inputSchema if hasattr(mcp_tool, "inputSchema") else {},
            "description": mcp_tool.description if hasattr(mcp_tool, "description") else "",
            "type": "tool",
        }

    def _convert_resource(self, mcp_resource: Resource, connector: BaseConnector) -> dict[str, Any]:
        """Convert an MCP resource to ReAct agent's tool format.

        Each resource becomes a tool-like interface that returns its content when called.

        Args:
            mcp_resource: The MCP resource to convert.
            connector: The connector that provides this resource.

        Returns:
            A dictionary containing resource information wrapped as a tool.
        """
        if not self.include_resources:
            return None

        # Create a tool name from the resource
        tool_name = f"read_resource_{mcp_resource.name or mcp_resource.uri}".replace("/", "_").replace(":", "_")

        return {
            "name": tool_name,
            "session": connector.client_session,
            "schema": {},  # Resources don't take parameters
            "description": mcp_resource.description or f"Read the content of resource: {mcp_resource.uri}",
            "type": "resource",
            "resource_uri": mcp_resource.uri,
        }

    def _convert_prompt(self, mcp_prompt: Prompt, connector: BaseConnector) -> dict[str, Any]:
        """Convert an MCP prompt to ReAct agent's tool format.

        The resulting tool executes `get_prompt` on the connector with the prompt's name and
        the user-provided arguments (if any).

        Args:
            mcp_prompt: The MCP prompt to convert.
            connector: The connector that provides this prompt.

        Returns:
            A dictionary containing prompt information wrapped as a tool.
        """
        if not self.include_prompts:
            return None

        # Build schema from prompt arguments
        schema = {
            "type": "object",
            "properties": {},
            "required": [],
        }

        if mcp_prompt.arguments:
            for arg in mcp_prompt.arguments:
                schema["properties"][arg.name] = {
                    "type": "string",  # Default to string type
                    "description": arg.description or "",
                }
                if arg.required:
                    schema["required"].append(arg.name)

        return {
            "name": f"get_prompt_{mcp_prompt.name}",
            "session": connector.client_session,
            "schema": schema,
            "description": mcp_prompt.description or f"Get the prompt: {mcp_prompt.name}",
            "type": "prompt",
            "prompt_name": mcp_prompt.name,
        }

    async def load_tools_for_connector(self, connector: BaseConnector) -> list[dict[str, Any]]:
        """Dynamically load tools for a specific connector.

        Overrides the base method to return dictionaries instead of tool objects.

        Args:
            connector: The connector to load tools for.

        Returns:
            The list of tools as dictionaries.
        """
        # Check if we already have tools for this connector
        if connector in self._connector_tool_map:
            logger.debug(f"Returning {len(self._connector_tool_map[connector])} existing tools for connector")
            return self._connector_tool_map[connector]

        # Create tools for this connector

        # Make sure the connector is initialized and has tools
        success = await self._ensure_connector_initialized(connector)
        if not success:
            return []

        connector_tools = []
        # Now create tools for each MCP tool
        for tool in await connector.list_tools():
            # Convert the tool and add it to the list if conversion was successful
            converted_tool = self._convert_tool(tool, connector)
            if converted_tool:
                connector_tools.append(converted_tool)

        # Convert resources to tools if enabled
        if self.include_resources:
            resources_list = await connector.list_resources() or []
            for resource in resources_list:
                converted_resource = self._convert_resource(resource, connector)
                if converted_resource:
                    connector_tools.append(converted_resource)

        # Convert prompts to tools if enabled
        if self.include_prompts:
            prompts_list = await connector.list_prompts() or []
            for prompt in prompts_list:
                converted_prompt = self._convert_prompt(prompt, connector)
                if converted_prompt:
                    connector_tools.append(converted_prompt)

        # Store the tools for this connector
        self._connector_tool_map[connector] = connector_tools

        # Log available tools for debugging
        logger.debug(
            f"Loaded {len(connector_tools)} new tools for connector: " f"{[tool['name'] for tool in connector_tools]}"
        )

        return connector_tools
