"""
LangChain adapter for MCP tools.

This module provides utilities to convert MCP tools to LangChain tools.

Uses StructuredTool.from_function() to avoid Pydantic deepcopy issues with
connector objects that contain asyncio primitives (Issue #734).
"""

import re
from typing import Any

from jsonschema_pydantic import jsonschema_to_pydantic
from langchain_core.tools import BaseTool, StructuredTool
from mcp.types import (
    AudioContent,
    BlobResourceContents,
    CallToolResult,
    EmbeddedResource,
    ImageContent,
    Prompt,
    Resource,
    TextContent,
    TextResourceContents,
)
from mcp.types import (
    Tool as MCPTool,
)
from pydantic import BaseModel, Field, create_model

from mcp_use.agents.adapters.base import BaseAdapter
from mcp_use.client.connectors.base import BaseConnector
from mcp_use.errors.error_formatting import format_error
from mcp_use.logging import logger

LangChainContentBlock = dict[str, Any]
LangChainToolResult = str | LangChainContentBlock | list[LangChainContentBlock]


def _mcp_content_to_langchain(content: list[Any]) -> str | list[LangChainContentBlock]:
    """Convert MCP tool result content to LangChain-compatible format.

    Maps MCP content types to LangChain content blocks:
      - TextContent        → {"type": "text", "text": "..."}
      - ImageContent       → {"type": "image", "source_type": "base64", ...}
      - AudioContent       → {"type": "audio", "source_type": "base64", ...}
      - EmbeddedResource   → text or file block depending on resource type

    If the result is a single TextContent, returns a plain string for simplicity.
    """
    if not content:
        return ""

    # Single TextContent → plain string (most common case)
    if len(content) == 1 and isinstance(content[0], TextContent):
        return content[0].text

    blocks: list[LangChainContentBlock] = []
    for item in content:
        match item:
            case TextContent():
                blocks.append({"type": "text", "text": item.text})
            case ImageContent():
                blocks.append(
                    {
                        "type": "image",
                        "source_type": "base64",
                        "data": item.data,
                        "mime_type": item.mimeType,
                    }
                )
            case AudioContent():
                blocks.append(
                    {
                        "type": "audio",
                        "source_type": "base64",
                        "data": item.data,
                        "mime_type": item.mimeType,
                    }
                )
            case EmbeddedResource():
                resource = item.resource
                if isinstance(resource, TextResourceContents):
                    blocks.append({"type": "text", "text": resource.text})
                elif isinstance(resource, BlobResourceContents):
                    blocks.append(
                        {
                            "type": "file",
                            "source_type": "base64",
                            "data": resource.blob,
                            "mime_type": resource.mimeType or "application/octet-stream",
                        }
                    )
                else:
                    blocks.append({"type": "text", "text": str(resource)})
            case _:
                # Fallback for unknown types
                blocks.append({"type": "text", "text": str(item)})

    if not blocks:
        return ""

    # If all blocks are text, join them as a plain string
    if all(b["type"] == "text" for b in blocks):
        return "\n".join(b["text"] for b in blocks)

    return blocks


class LangChainAdapter(BaseAdapter[BaseTool]):
    """Adapter for converting MCP tools to LangChain tools.

    This adapter uses StructuredTool.from_function() which captures connectors
    via closures instead of storing them as Pydantic model fields. This avoids
    issues with deepcopy of asyncio objects (Event, Task, Future) that cannot
    be pickled.
    """

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

        Uses StructuredTool.from_function() with a closure to capture the connector,
        avoiding Pydantic field deepcopy issues with asyncio objects.

        Args:
            mcp_tool: The MCP tool to convert.
            connector: The connector that provides this tool.

        Returns:
            A LangChain BaseTool, or None if the tool is disallowed.
        """
        # Skip disallowed tools
        if mcp_tool.name in self.disallowed_tools:
            return None

        # Capture in closure - connector is NOT stored as a Pydantic field
        _connector = connector
        _tool_name = mcp_tool.name or "NO NAME"

        async def _execute_tool(**kwargs: Any) -> LangChainToolResult:
            """Execute the MCP tool asynchronously.

            Args:
                kwargs: The arguments to pass to the tool.

            Returns:
                The result of the tool execution.
            """
            logger.debug(f'MCP tool: "{_tool_name}" received input: {kwargs}')

            try:
                tool_result: CallToolResult = await _connector.call_tool(_tool_name, kwargs)
                converted_content: LangChainToolResult | None = None
                try:
                    converted_content = _mcp_content_to_langchain(tool_result.content)
                    if tool_result.isError:
                        error_message = (
                            converted_content
                            if isinstance(converted_content, str)
                            else "MCP tool returned an error result"
                        )
                        raise RuntimeError(error_message or "MCP tool returned an empty error result")
                    return converted_content
                except Exception as e:
                    logger.error(f"Error parsing tool result: {e}")
                    return format_error(
                        e,
                        tool=_tool_name,
                        tool_content=converted_content if converted_content is not None else tool_result.content,
                    )
            except Exception as e:
                return format_error(e, tool=_tool_name)

        # Build args_schema from MCP tool's input schema
        args_schema = jsonschema_to_pydantic(self.fix_schema(mcp_tool.inputSchema))

        return StructuredTool.from_function(
            coroutine=_execute_tool,
            name=_tool_name,
            description=mcp_tool.description or "",
            args_schema=args_schema,
            handle_tool_error=True,
        )

    def _convert_resource(self, mcp_resource: Resource, connector: BaseConnector) -> BaseTool:
        """Convert an MCP resource to LangChain's tool format.

        Each resource becomes an async tool that returns its content when called.
        Uses StructuredTool.from_function() with a closure to capture the connector.

        Args:
            mcp_resource: The MCP resource to convert.
            connector: The connector that provides this resource.

        Returns:
            A LangChain BaseTool for accessing the resource.
        """

        def _sanitize(name: str) -> str:
            return re.sub(r"[^A-Za-z0-9_]+", "_", name).lower().strip("_")

        # Capture in closure
        _connector = connector
        _resource_uri = mcp_resource.uri
        _tool_name = _sanitize(mcp_resource.name or f"resource_{mcp_resource.uri}")

        async def _read_resource(**kwargs: Any) -> str:
            """Read the MCP resource asynchronously.

            Returns:
                The content of the resource as a string.
            """
            logger.debug(f'Resource tool: "{_tool_name}" called')
            try:
                result = await _connector.read_resource(_resource_uri)
                content_decoded = ""
                for content in result.contents:
                    if isinstance(content, bytes):
                        content_decoded = content.decode()
                    else:
                        content_decoded = str(content)
                return content_decoded
            except Exception as e:
                return format_error(e, tool=_tool_name)

        # Create a simple empty schema for resources (they don't take arguments)
        ResourceArgsSchema = create_model(f"{_tool_name}_Args", __base__=BaseModel)

        description = mcp_resource.description or f"Return the content of the resource located at URI {_resource_uri}."

        return StructuredTool.from_function(
            coroutine=_read_resource,
            name=_tool_name,
            description=description,
            args_schema=ResourceArgsSchema,
            handle_tool_error=True,
        )

    def _convert_prompt(self, mcp_prompt: Prompt, connector: BaseConnector) -> BaseTool:
        """Convert an MCP prompt to LangChain's tool format.

        The resulting tool executes `get_prompt` on the connector with the prompt's name and
        the user-provided arguments (if any). Uses StructuredTool.from_function() with a
        closure to capture the connector.

        Args:
            mcp_prompt: The MCP prompt to convert.
            connector: The connector that provides this prompt.

        Returns:
            A LangChain BaseTool for executing the prompt.
        """
        prompt_arguments = mcp_prompt.arguments

        # Sanitize the prompt name to create a valid Python identifier for the model name
        base_model_name = re.sub(r"[^a-zA-Z0-9_]", "_", mcp_prompt.name)
        if not base_model_name or base_model_name[0].isdigit():
            base_model_name = "PromptArgs_" + base_model_name
        dynamic_model_name = f"{base_model_name}_InputSchema"

        # Build the input schema dynamically based on prompt arguments
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
            InputSchema = create_model(dynamic_model_name, __base__=BaseModel)

        # Capture in closure
        _connector = connector
        _prompt_name = mcp_prompt.name

        async def _get_prompt(**kwargs: Any) -> Any:
            """Get the MCP prompt asynchronously.

            Args:
                kwargs: The arguments to pass to the prompt.

            Returns:
                The prompt messages.
            """
            logger.debug(f'Prompt tool: "{_prompt_name}" called with args: {kwargs}')
            try:
                result = await _connector.get_prompt(_prompt_name, kwargs)
                return result.messages
            except Exception as e:
                return format_error(e, tool=_prompt_name)

        return StructuredTool.from_function(
            coroutine=_get_prompt,
            name=_prompt_name,
            description=mcp_prompt.description or "",
            args_schema=InputSchema,
            handle_tool_error=True,
        )
