"""
Middleware for handling tool validation and execution errors.

This middleware wraps tool calls to catch any exceptions (including ValidationErrors)
and returns them as formatted error messages to the LLM, enabling automatic retry.
"""

from typing import Any

from langchain.agents.middleware import wrap_tool_call
from langchain.agents.middleware.types import ToolCallRequest
from langchain_core.messages import ToolMessage

from mcp_use.errors.error_formatting import format_error
from mcp_use.logging import logger


@wrap_tool_call
async def tool_error_handler(request: ToolCallRequest, handler: Any) -> ToolMessage:
    """Wrap tool calls to catch and format any errors.

    This middleware intercepts ALL tool calls and catches any exceptions that occur,
    including:
    - ValidationError: Raised by Pydantic when tool input doesn't match the schema
    - ConnectionError: When MCP server connection fails
    - Any other runtime errors during tool execution

    Instead of raising exceptions (which would halt execution), it formats the error
    message and returns it to the LLM as a ToolMessage, allowing the agent to read
    the error and retry with corrected input.

    This is the proper LangChain way to handle tool errors, as it intercepts at the
    right level - after the agent decides to call a tool, but wrapping the entire
    execution including validation.

    Args:
        request: The tool call request dict containing:
            - tool: The tool name
            - tool_call_id: The unique ID for this tool call
            - input: The input arguments
        handler: The function that actually executes the tool (including validation)

    Returns:
        ToolMessage containing either:
        - The successful tool result, OR
        - A formatted error message that the LLM can read and use to retry

    Example error message returned to LLM:
        "Tool input validation failed. Please fix the following errors and retry:
          - body.metaData: Field required (type: missing)"
    """
    try:
        # Call the handler which will:
        # 1. Validate the input against the tool's args_schema
        # 2. Execute the tool's _arun method
        # 3. Return the result'
        return await handler(request)
    except Exception as e:
        tool_name = request.tool_call["name"]
        tool_call_id = request.tool_call["id"]
        error_msg = format_error(e, tool=tool_name)

        logger.warning(f"Tool '{tool_name}' failed, returning error to LLM: {type(e).__name__}")
        logger.debug(f"Error details: {error_msg}")

        # Return the error as a ToolMessage so it appears in the conversation
        # The LLM will see this message and can decide to retry with corrected input
        return ToolMessage(
            content=error_msg,
            tool_call_id=tool_call_id,
        )
