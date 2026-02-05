"""Utility functions for stream operations in MCP agents."""

from collections.abc import Sequence
from typing import Any

from langchain_core.messages import BaseMessage
from langchain_core.tools import BaseTool


def normalize_message_content(message: object) -> str:
    """Normalize message content to a string representation."""
    try:
        if isinstance(message, str):
            return message

        content = getattr(message, "content", None)
        if content is not None:
            return normalize_message_content(content)

        if isinstance(message, list):
            parts: list[str] = []
            for item in message:
                if isinstance(item, dict):
                    if "text" in item and isinstance(item["text"], str):
                        parts.append(item["text"])
                    elif "content" in item:
                        parts.append(normalize_message_content(item["content"]))
                    else:
                        parts.append(str(item))
                else:
                    parts.append(str(item))
            return "".join(parts)

        return str(message)
    except Exception:
        return str(message)


def extract_tool_calls_from_message(message: object) -> list[dict[str, Any]]:
    """Extract tool calls from a message.
    
    Returns an array of tool call dictionaries with name, args, and optional id.
    Handles both LangChain message objects (with tool_calls attribute) and
    plain dictionaries with tool_calls key.
    
    Args:
        message: The message object that may contain tool_calls (as attribute or dict key).
    
    Returns:
        A list of tool call dictionaries, each with 'name', 'args', and optionally 'id'.
        Returns an empty list if no tool calls are found.
    """
    tool_calls = None
    
    # Try to get tool_calls as an attribute first (LangChain message objects)
    if hasattr(message, "tool_calls"):
        tool_calls = getattr(message, "tool_calls", None)
    # Fallback to dictionary key access
    elif isinstance(message, dict):
        tool_calls = message.get("tool_calls")
    
    if not tool_calls or not isinstance(tool_calls, (list, Sequence)):
        return []
    
    result: list[dict[str, Any]] = []
    for tool_call in tool_calls:
        # Handle both dictionary and object-style tool calls
        if isinstance(tool_call, dict):
            result.append({
                "name": tool_call.get("name", "unknown"),
                "args": tool_call.get("args", {}),
                "id": tool_call.get("id"),
            })
        elif hasattr(tool_call, "name") and hasattr(tool_call, "args"):
            # Handle object-style tool calls (e.g., from LangChain)
            result.append({
                "name": getattr(tool_call, "name", "unknown"),
                "args": getattr(tool_call, "args", {}),
                "id": getattr(tool_call, "id", None),
            })
    
    return result


def detect_tool_updates(
    current_tools: list[BaseTool],
    existing_tools: list[BaseTool],
) -> bool:
    """Detect if tools have been updated by comparing tool names."""
    current_tool_names = {tool.name for tool in current_tools}
    existing_tool_names = {tool.name for tool in existing_tools}
    return current_tool_names != existing_tool_names


def format_tool_input_for_logging(tool_input: object) -> str:
    """Format tool input for logging, truncating if needed."""
    tool_input_str = str(tool_input)
    if len(tool_input_str) > 100:
        return tool_input_str[:97] + "..."
    return tool_input_str


def format_observation_for_logging(observation: object) -> str:
    """Format observation for logging, truncating and normalizing newlines."""
    observation_str = str(observation)
    if len(observation_str) > 100:
        observation_str = observation_str[:97] + "..."
    return observation_str.replace("\n", " ")


def extract_message_text_content(message: object) -> str:
    """Extract readable text content from a message for logging purposes.
    
    Handles both string content and list-based multi-part content.
    
    Args:
        message: The message object that may have content attribute.
    
    Returns:
        A string representation of the message's text content, or empty string if none found.
    """
    if not hasattr(message, "content"):
        return ""
    
    content = getattr(message, "content", None)
    
    # String content
    if isinstance(content, str):
        return content
    
    # List-based content (multi-part messages)
    if isinstance(content, list):
        text_parts: list[str] = []
        for block in content:
            if isinstance(block, dict):
                block_type = block.get("type", "")
                if block_type == "text" and "text" in block:
                    text_parts.append(str(block["text"]))
                else:
                    # Fallback for non-text blocks
                    text_parts.append(str(block))
            else:
                text_parts.append(str(block))
        return "\n".join(text_parts)
    
    return str(content) if content is not None else ""


def accumulate_messages(
    messages: list[BaseMessage],
    accumulated_messages: list[BaseMessage],
) -> None:
    """Accumulate messages, avoiding duplicates based on reference equality.
    
    Adds new messages to the accumulated array if they're not already present.
    This uses reference equality (Python's 'is' operator) to detect duplicates,
    which works correctly for LangChain message objects.
    
    Args:
        messages: New messages to potentially add.
        accumulated_messages: The list of accumulated messages to update in-place.
    """
    for msg in messages:
        if msg not in accumulated_messages:
            accumulated_messages.append(msg)