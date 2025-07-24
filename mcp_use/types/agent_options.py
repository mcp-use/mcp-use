from collections.abc import Callable
from typing import Any, TypedDict


class AgentCallbacks(TypedDict, total=False):
    """Callback functions for agent tool execution lifecycle events."""

    on_tool_start: Callable[[str, dict[str, Any]], None]
    """Called when a tool execution starts.

    Args:
        tool_name: Name of the tool being executed
        tool_input: Input arguments passed to the tool
    """

    on_tool_complete: Callable[[str, dict[str, Any], Any], None]
    """Called when a tool execution completes successfully.

    Args:
        tool_name: Name of the tool that was executed
        tool_input: Input arguments that were passed to the tool
        tool_result: The result returned by the tool
    """

    on_tool_error: Callable[[str, dict[str, Any], Exception], None]
    """Called when a tool execution fails with an error.

    Args:
        tool_name: Name of the tool that failed
        tool_input: Input arguments that were passed to the tool
        error: The exception that occurred during execution
    """


class AgentOptions(TypedDict, total=False):
    """Optional configuration for MCPAgent behavior."""

    callbacks: AgentCallbacks
    """Callback functions for tool execution lifecycle events."""
