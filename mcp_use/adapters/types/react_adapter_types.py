from collections.abc import Callable
from enum import Enum
from typing import Any, NotRequired, TypedDict


class ToolType(str, Enum):
    """Type of tool in the ReAct agent."""

    TOOL = "tool"
    RESOURCE = "resource"
    PROMPT = "prompt"


class ReactTool(TypedDict):
    """Type definition for a tool in the ReAct agent.

    This represents how tools are stored and accessed within the ReAct agent,
    providing all necessary information for tool execution.
    """

    name: str
    execute: Callable[[dict[str, Any]], Any]
    schema: dict[str, Any]
    description: str
    type: ToolType
    # Optional fields for specific tool types
    resource_uri: NotRequired[str]  # Only for resource tools
    prompt_name: NotRequired[str]  # Only for prompt tools
