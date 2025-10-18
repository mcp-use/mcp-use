"""
Base adapter interface for MCP tools.

This module provides the abstract base class that all MCP tool adapters should inherit from.
"""

from abc import ABC, abstractmethod
from typing import TypeVar, Any

from mcp.types import Prompt, Resource, Tool, CallToolResult

from mcp_use.client.client import MCPClient
from mcp_use.client.connectors.base import BaseConnector
from mcp_use.logging import logger
from mcp_use.telemetry.telemetry import telemetry

# Generic type for the tools created by the adapter
T = TypeVar("T")


class BaseAdapter(ABC):
    """Abstract base class for converting MCP tools to other framework formats.

    This class defines the common interface that all adapter implementations
    should follow to ensure consistency across different frameworks.
    """

    def __init__(self, disallowed_tools: list[str] | None = None) -> None:
        """Initialize a new adapter.

        Args:
            disallowed_tools: list of tool names that should not be available.
        """
        self.disallowed_tools = disallowed_tools or []

        # Three maps to optimize and cache only what is needed
        self._connector_tool_map: dict[BaseConnector, list[T]] = {}
        self._connector_resource_map: dict[BaseConnector, list[T]] = {}
        self._connector_prompt_map: dict[BaseConnector, list[T]] = {}

        self.tools: list[T] = []
        self.resources: list[T] = []
        self.prompts: list[T] = []

    def parse_result(self, tool_result: Any) -> str:
        """Parse the result from any MCP operation (tool, resource, or prompt) into a string.

        Args:
            tool_result: The result object from an MCP operation.

        Returns:
            A string representation of the result content.
        """
        if getattr(tool_result, "isError", False):
            # Handle errors first
            error_content = tool_result.content or "Unknown error"
            return f"Error: {error_content}"
        elif hasattr(tool_result, "contents"):  # For Resources (ReadResourceResult)
            return "\n".join(c.decode() if isinstance(c, bytes) else str(c) for c in tool_result.contents)
        elif hasattr(tool_result, "messages"):  # For Prompts (GetPromptResult)
            return "\n".join(str(s) for s in tool_result.messages)
        elif hasattr(tool_result, "content"):  # For Tools (CallToolResult)
            return str(tool_result.content)
        else:
            # Fallback for unexpected types
            return str(tool_result)

    def fix_schema(self, schema: dict) -> dict:
        """Convert JSON Schema 'type': ['string', 'null'] to 'anyOf' format and fix enum handling.

        Args:
            schema: The JSON schema to fix.

        Returns:
            The fixed JSON schema.
        """
        if isinstance(schema, dict):
            if "type" in schema and isinstance(schema["type"], list):
                schema["anyOf"] = [{"type": t} for t in schema["type"]]
                del schema["type"]  # Remove 'type' and standardize to 'anyOf'

            # Fix enum handling - ensure enum fields are properly typed as strings
            if "enum" in schema and "type" not in schema:
                schema["type"] = "string"

            for key, value in schema.items():
                schema[key] = self.fix_schema(value)  # Apply recursively
        return schema

    async def _get_connectors(self, client: MCPClient) -> list[BaseConnector]:
        """Get all connectors from the client, creating sessions if needed."""
        if not client.active_sessions:
            logger.info("No active sessions found, creating new ones...")
            await client.create_all_sessions()

        sessions = client.get_all_active_sessions()
        return [session.connector for session in sessions.values()]

    async def create_all(self, client: MCPClient) -> None:
        """Create tools, resources, and prompts from an MCPClient instance."""
        await self.create_tools(client)
        await self.create_resources(client)
        await self.create_prompts(client)

    async def create_tools(self, client: MCPClient) -> list[T]:
        """Create tools from the MCPClient instance.

        This handles session creation and connector extraction automatically.
        The created tools are stored in `self.tools`.

        Returns:
            A list of tools in the target framework's format.
        """
        connectors = await self._get_connectors(client)
        self.tools = await self._create_tools_from_connectors(connectors)

        return self.tools

    async def create_resources(self, client: MCPClient) -> list[T]:
        """Create resources from the MCPClient instance.

        This handles session creation and connector extraction automatically.
        The created resources are stored in `self.resources`.

        Returns:
            A list of resources in the target framework's format.
        """
        connectors = await self._get_connectors(client)
        self.resources = await self._create_resources_from_connectors(connectors)

        return self.resources

    async def create_prompts(self, client: MCPClient) -> list[T]:
        """Create prompts from the MCPClient instance.

        This handles session creation and connector extraction automatically.
        The created prompts are stored in `self.prompts`.

        Returns:
            A list of prompts in the target framework's format.
        """
        connectors = await self._get_connectors(client)
        self.prompts = await self._create_prompts_from_connectors(connectors)

        return self.prompts

    @telemetry("adapter_load_tools")
    async def load_tools_for_connector(self, connector: BaseConnector) -> list[T]:
        """Dynamically load tools for a specific connector.

        Args:
            connector: The connector to load tools for.

        Returns:
            The list of tools that were loaded in the target framework's format.
        """
        # Check if we already have tools for this connector
        if connector in self._connector_tool_map:
            logger.debug(f"Returning {len(self._connector_tool_map[connector])} existing tools for connector")
            return self._connector_tool_map[connector]

        if not await self._ensure_connector_initialized(connector):
            return []

        connector_tools = []
        for tool in await connector.list_tools():
            converted_tool = self._convert_tool(tool, connector)
            if converted_tool:
                connector_tools.append(converted_tool)

        # Store the tools for this connector
        self._connector_tool_map[connector] = connector_tools

        # Log available tools for debugging
        logger.debug(
            f"Loaded {len(connector_tools)} new tools for connector: "
            f"{[getattr(tool, 'name', str(tool)) for tool in connector_tools]}"
        )

        return connector_tools

    @telemetry("adapter_load_resources")
    async def load_resources_for_connector(self, connector: BaseConnector):
        """Dynamically load resources for a specific connector.

        Args:
            connector: The connector to load resources for.

        Returns:
            The list of resources that were loaded in the target framework's format.
        """
        if connector in self._connector_resource_map:
            logger.debug(f"Returning {len(self._connector_resource_map[connector])} existing resources for connector")
            return self._connector_resource_map[connector]

        if not await self._ensure_connector_initialized(connector):
            return []

        connector_resources = []
        for resource in await connector.list_resources() or []:
            converted_resource = self._convert_resource(resource, connector)
            if converted_resource:
                connector_resources.append(converted_resource)

        self._connector_resource_map[connector] = connector_resources
        logger.debug(
            f"Loaded {len(connector_resources)} new resources for connector: "
            f"{[getattr(r, 'name', str(r)) for r in connector_resources]}"
        )
        return connector_resources
    
    @telemetry("adapter_load_prompts")
    async def load_prompts_for_connector(self, connector: BaseConnector) -> list[T]:
        """Dynamically load prompts for a specific connector.

        Args:
            connector: The connector to load prompts for.

        Returns:
            The list of prompts that were loaded in the target framework's format.
        """
        if connector in self._connector_prompt_map:
            logger.debug(f"Returning {len(self._connector_prompt_map[connector])} existing prompts for connector")
            return self._connector_prompt_map[connector]

        if not await self._ensure_connector_initialized(connector):
            return []

        connector_prompts = []
        for prompt in await connector.list_prompts() or []:
            converted_prompt = self._convert_prompt(prompt, connector)
            if converted_prompt:
                connector_prompts.append(converted_prompt)

        self._connector_prompt_map[connector] = connector_prompts
        logger.debug(
            f"Loaded {len(connector_prompts)} new prompts for connector: "
            f"{[getattr(p, 'name', str(p)) for p in connector_prompts]}"
        )
        return connector_prompts

    @abstractmethod
    def _convert_tool(self, mcp_tool: Tool, connector: BaseConnector) -> T:
        """Convert an MCP tool to the target framework's tool format."""
        pass

    @abstractmethod
    def _convert_resource(self, mcp_resource: Resource, connector: BaseConnector) -> T:
        """Convert an MCP resource to the target framework's resource format."""
        pass

    @abstractmethod
    def _convert_prompt(self, mcp_prompt: Prompt, connector: BaseConnector) -> T:
        """Convert an MCP prompt to the target framework's prompt format."""
        pass

    async def _create_tools_from_connectors(self, connectors: list[BaseConnector]) -> list[T]:
        """Create tools from MCP tools in all provided connectors.

        Args:
            connectors: list of MCP connectors to create tools from.

        Returns:
            A list of tools in the target framework's format.
        """
        tools = []
        for connector in connectors:
            # Create tools for this connector
            connector_tools = await self.load_tools_for_connector(connector)
            tools.extend(connector_tools)

        # Log available tools for debugging
        logger.debug(f"Available tools: {len(tools)}")
        return tools

    async def _create_tools_from_connectors(self, connectors: list[BaseConnector]) -> list[T]:
        """Create tools from MCP tools in all provided connectors."""
        tools = []
        for connector in connectors:
            connector_tools = await self.load_tools_for_connector(connector)
            tools.extend(connector_tools)

        logger.debug(f"Available tools: {len(tools)}")
        return tools

    async def _create_resources_from_connectors(self, connectors: list[BaseConnector]) -> list[T]:
        """Create resources from MCP resources in all provided connectors."""
        resources = []
        for connector in connectors:
            connector_resources = await self.load_resources_for_connector(connector)
            resources.extend(connector_resources)

        logger.debug(f"Available resources: {len(resources)}")
        return resources

    async def _create_prompts_from_connectors(self, connectors: list[BaseConnector]) -> list[T]:
        """Create prompts from MCP prompts in all provided connectors."""
        prompts = []
        for connector in connectors:
            connector_prompts = await self.load_prompts_for_connector(connector)
            prompts.extend(connector_prompts)

        logger.debug(f"Available prompts: {len(prompts)}")
        return prompts

    def _check_connector_initialized(self, connector: BaseConnector) -> bool:
        """Check if a connector is initialized and has tools.

        Args:
            connector: The connector to check.

        Returns:
            True if the connector is initialized and has tools, False otherwise.
        """
        return hasattr(connector, "tools") and connector.tools

    async def _ensure_connector_initialized(self, connector: BaseConnector) -> bool:
        """Ensure a connector is initialized.

        Args:
            connector: The connector to initialize.

        Returns:
            True if initialization succeeded, False otherwise.
        """
        if not self._check_connector_initialized(connector):
            logger.debug("Connector doesn't have tools, initializing it")
            try:
                await connector.initialize()
                return True
            except Exception as e:
                logger.error(f"Error initializing connector: {e}")
                return False
        return True