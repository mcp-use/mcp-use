"""
LangChain adapter for MCP tools.

This module provides utilities to convert MCP tools to LangChain tools.
"""

import re
from typing import Any, NoReturn

from jsonschema_pydantic import jsonschema_to_pydantic
from langchain_core.tools import BaseTool
from mcp.types import (
    CallToolResult,
    Prompt,
    ReadResourceRequestParams,
    Resource,
)
from mcp.types import (
    Tool as MCPTool,
)
from pydantic import BaseModel, Field, create_model

from mcp_use.agents.adapters.base import BaseAdapter
from mcp_use.client.connectors.base import BaseConnector
from mcp_use.errors.error_formatting import format_error
from mcp_use.logging import logger


class LangChainAdapter(BaseAdapter[BaseTool]):
    """Adapter for converting MCP tools to LangChain tools."""

    def __init__(self, disallowed_tools: list[str] | None = None) -> None:
        """Initialize a new LangChain adapter.

        Args:
            disallowed_tools: list of tool names that should not be available.
        """
        super().__init__(disallowed_tools)
        self._connector_tool_map: dict[BaseConnector, list[BaseTool]] = {}
        self._connector_resource_map: dict[BaseConnector, list[BaseTool]] = {}
        self._connector_prompt_map: dict[BaseConnector, list[BaseTool]] = {}

        self.tools: list[BaseTool] = []
        self.resources: list[BaseTool] = []
        self.prompts: list[BaseTool] = []

    def _convert_tool(self, mcp_tool: MCPTool, connector: BaseConnector) -> BaseTool | None:
        """Convert an MCP tool to LangChain's tool format.

        Args:
            mcp_tool: The MCP tool to convert.
            connector: The connector that provides this tool.

        Returns:
            A LangChain BaseTool.
        """
        # Skip disallowed tools
        if mcp_tool.name in self.disallowed_tools:
            return None

        # This is a dynamic class creation, we need to work with the self reference
        adapter_self = self

        class McpToLangChainAdapter(BaseTool):
            name: str = mcp_tool.name or "NO NAME"
            description: str = mcp_tool.description or ""
            # Convert JSON schema to Pydantic model for argument validation
            args_schema: type[BaseModel] = jsonschema_to_pydantic(
                adapter_self.fix_schema(mcp_tool.inputSchema)  # Apply schema conversion
            )
            tool_connector: BaseConnector = connector  # Renamed variable to avoid name conflict
            handle_tool_error: bool = True

            def __repr__(self) -> str:
                return f"MCP tool: {self.name}: {self.description}"

            def _run(self, **kwargs: Any) -> NoReturn:
                """Synchronous run method that always raises an error.

                Raises:
                    NotImplementedError: Always raises this error because MCP tools
                        only support async operations.
                """
                raise NotImplementedError("MCP tools only support async operations")

            async def _arun(self, **kwargs: Any) -> str | dict:
                """Asynchronously execute the tool with given arguments.

                Args:
                    kwargs: The arguments to pass to the tool.

                Returns:
                    The result of the tool execution.

                Raises:
                    ToolException: If tool execution fails.
                """
                logger.debug(f'MCP tool: "{self.name}" received input: {kwargs}')

                try:
                    tool_result: CallToolResult = await self.tool_connector.call_tool(self.name, kwargs)
                    try:
                        # Use the helper function to parse the result
                        return str(tool_result.content)
                    except Exception as e:
                        # Log the exception for debugging
                        logger.error(f"Error parsing tool result: {e}")
                        return format_error(e, tool=self.name, tool_content=tool_result.content)

                except Exception as e:
                    if self.handle_tool_error:
                        return format_error(e, tool=self.name)  # Format the error to make LLM understand it
                    raise

        return McpToLangChainAdapter()

    def _convert_resource(self, mcp_resource: Resource, connector: BaseConnector) -> BaseTool:
        """Convert an MCP resource to LangChain's tool format.

        Each resource becomes an async tool that returns its content when called.
        The tool takes **no** arguments because the resource URI is fixed.
        """

        def _sanitize(name: str) -> str:
            return re.sub(r"[^A-Za-z0-9_]+", "_", name).lower().strip("_")

        class ResourceTool(BaseTool):
            name: str = _sanitize(mcp_resource.name or f"resource_{mcp_resource.uri}")
            description: str = (
                mcp_resource.description or f"Return the content of the resource located at URI {mcp_resource.uri}."
            )
            args_schema: type[BaseModel] = ReadResourceRequestParams
            tool_connector: BaseConnector = connector
            handle_tool_error: bool = True

            def _run(self, **kwargs: Any) -> NoReturn:
                raise NotImplementedError("Resource tools only support async operations")

            async def _arun(self, **kwargs: Any) -> Any:
                logger.debug(f'Resource tool: "{self.name}" called')
                try:
                    result = await self.tool_connector.read_resource(mcp_resource.uri)
                    for content in result.contents:
                        # Attempt to decode bytes if necessary
                        if isinstance(content, bytes):
                            content_decoded = content.decode()
                        else:
                            content_decoded = str(content)

                    return content_decoded
                except Exception as e:
                    if self.handle_tool_error:
                        return format_error(e, tool=self.name)  # Format the error to make LLM understand it
                    raise

        return ResourceTool()

    def _convert_prompt(self, mcp_prompt: Prompt, connector: BaseConnector) -> BaseTool:
        """Convert an MCP prompt to LangChain's tool format.

        The resulting tool executes `get_prompt` on the connector with the prompt's name and
        the user-provided arguments (if any). The tool returns the decoded prompt content.
        """
        prompt_arguments = mcp_prompt.arguments

        # Sanitize the prompt name to create a valid Python identifier for the model name
        base_model_name = re.sub(r"[^a-zA-Z0-9_]", "_", mcp_prompt.name)
        if not base_model_name or base_model_name[0].isdigit():
            base_model_name = "PromptArgs_" + base_model_name
        dynamic_model_name = f"{base_model_name}_InputSchema"

        if prompt_arguments:
            field_definitions_for_create: dict[str, Any] = {}
            for arg in prompt_arguments:
                param_type: type = getattr(arg, "type", str)
                if arg.required:
                    field_definitions_for_create[arg.name] = (
                        param_type,
                        Field(description=arg.description),
                    )
                else:
                    field_definitions_for_create[arg.name] = (
                        param_type | None,
                        Field(None, description=arg.description),
                    )

            InputSchema = create_model(dynamic_model_name, **field_definitions_for_create, __base__=BaseModel)
        else:
            # Create an empty Pydantic model if there are no arguments
            InputSchema = create_model(dynamic_model_name, __base__=BaseModel)

        class PromptTool(BaseTool):
            name: str = mcp_prompt.name
            description: str | None = mcp_prompt.description

            args_schema: type[BaseModel] = InputSchema
            tool_connector: BaseConnector = connector
            handle_tool_error: bool = True

            def _run(self, **kwargs: Any) -> NoReturn:
                raise NotImplementedError("Prompt tools only support async operations")

            async def _arun(self, **kwargs: Any) -> Any:
                logger.debug(f'Prompt tool: "{self.name}" called with args: {kwargs}')
                try:
                    result = await self.tool_connector.get_prompt(self.name, kwargs)
                    return result.messages
                except Exception as e:
                    if self.handle_tool_error:
                        return format_error(e, tool=self.name)  # Format the error to make LLM understand it
                    raise

        return PromptTool()
