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


class _EmptyInput(BaseModel):
    """Empty input schema for tools that take no arguments."""

    pass


def _resolve_ref(schema: Any, root_schema: Any, seen_refs: frozenset[str] = frozenset()) -> Any:
    """Follow a local JSON Pointer $ref within root_schema (including $defs refs).

    Unlike fix_schema, this resolves all #/ refs — including #/$defs — so that
    _schema_allows_null can detect nullability through definition references.
    """
    if not isinstance(schema, dict):
        return schema
    ref = schema.get("$ref")
    if not isinstance(ref, str) or not ref.startswith("#/") or ref in seen_refs:
        return schema
    try:
        resolved: Any = root_schema
        for part in ref[2:].split("/"):
            part = part.replace("~1", "/").replace("~0", "~")  # RFC 6901
            resolved = resolved[int(part) if isinstance(resolved, list) else part]
    except (KeyError, TypeError, IndexError, ValueError):
        return schema
    return _resolve_ref(resolved, root_schema, seen_refs | {ref})


def _schema_allows_null(schema: Any, root_schema: Any) -> bool:
    """Return True if schema or any of its branches permit a null value."""
    if not isinstance(schema, dict):
        return False
    resolved = _resolve_ref(schema, root_schema)
    if resolved is not schema:
        return _schema_allows_null(resolved, root_schema)
    schema_type = schema.get("type")
    if schema_type == "null":
        return True
    if isinstance(schema_type, list) and "null" in schema_type:
        return True
    for combinator in ("anyOf", "oneOf"):
        options = schema.get(combinator)
        if isinstance(options, list) and any(_schema_allows_null(option, root_schema) for option in options):
            return True
    # Be conservative for allOf: preserve null if any branch allows it.
    all_of = schema.get("allOf")
    if isinstance(all_of, list) and any(_schema_allows_null(option, root_schema) for option in all_of):
        return True
    return False


class LangChainAdapter(BaseAdapter[BaseTool]):
    """Adapter for converting MCP tools to LangChain tools."""

    framework: str = "langchain"

    def __init__(self, disallowed_tools: list[str] | None = None) -> None:
        """Initialize a new LangChain adapter.

        Args:
            disallowed_tools: list of tool names that should not be available.
        """
        super().__init__(disallowed_tools=disallowed_tools)
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
        fixed_input_schema = adapter_self.fix_schema(mcp_tool.inputSchema)

        nullable_optional_fields: set[str] = set()
        if isinstance(fixed_input_schema, dict):
            required_fields = set(fixed_input_schema.get("required", []))
            properties = fixed_input_schema.get("properties", {})
            if isinstance(properties, dict):
                nullable_optional_fields = {
                    field_name
                    for field_name, field_schema in properties.items()
                    if field_name not in required_fields and _schema_allows_null(field_schema, fixed_input_schema)
                }

        class McpToLangChainAdapter(BaseTool):
            name: str = mcp_tool.name or "NO NAME"
            description: str = mcp_tool.description or ""
            # Convert JSON schema to Pydantic model for argument validation
            args_schema: type[BaseModel] = jsonschema_to_pydantic(
                fixed_input_schema  # Apply schema conversion
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

                # Strip None values for optional fields so they are sent as
                # absent rather than JSON null. Keep None when the MCP schema
                # explicitly allows null or the field is required.
                filtered_kwargs: dict[str, Any] = {}
                for key, value in kwargs.items():
                    if value is not None:
                        filtered_kwargs[key] = value
                        continue

                    field_info = self.args_schema.model_fields.get(key)
                    if (field_info and field_info.is_required()) or key in nullable_optional_fields:
                        filtered_kwargs[key] = value

                try:
                    tool_result: CallToolResult = await self.tool_connector.call_tool(self.name, filtered_kwargs)
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
            args_schema: type[BaseModel] = _EmptyInput
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
