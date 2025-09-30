"""
Integration helpers for connecting output formatting with MCPAgent.

This module provides helper functions and decorators to seamlessly
integrate pretty printing into agent run() and stream() methods.
"""

from collections.abc import AsyncGenerator
from typing import Any, Callable, Optional, TypeVar, Union

from langchain_core.agents import AgentAction

from .config import OutputConfig
from .types import AgentOutput, AgentOutputEvent, EventType

T = TypeVar("T")


def create_output_from_result(
    result: Union[str, Any],
    execution_time_ms: Optional[int] = None,
    steps_taken: Optional[int] = None,
    tools_used: Optional[list[str]] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> AgentOutput:
    """
    Create an AgentOutput from a result.

    Args:
        result: The result from agent execution
        execution_time_ms: Execution time in milliseconds
        steps_taken: Number of steps taken
        tools_used: List of tool names used
        metadata: Additional metadata

    Returns:
        AgentOutput instance
    """
    pass


def create_event_from_step(
    step: tuple[AgentAction, str],
    event_type: EventType = EventType.TOOL_CALL_COMPLETED,
) -> AgentOutputEvent:
    """
    Create an AgentOutputEvent from an agent step.

    Args:
        step: Tuple of (AgentAction, observation)
        event_type: Type of event

    Returns:
        AgentOutputEvent instance
    """
    pass


async def wrap_stream_with_formatting(
    stream: AsyncGenerator[tuple[AgentAction, str] | str | T, None],
    config: Optional[OutputConfig] = None,
    auto_print: bool = True,
) -> AsyncGenerator[tuple[AgentAction, str] | str | T, None]:
    """
    Wrap a stream to add automatic formatting.

    This generator wraps the agent's stream and optionally prints
    formatted output while still yielding the original items.

    Args:
        stream: The original stream from agent
        config: Output configuration
        auto_print: Whether to automatically print formatted output

    Yields:
        Original stream items
    """
    pass


def format_and_print_result(
    result: Union[str, Any],
    config: Optional[OutputConfig] = None,
) -> None:
    """
    Format and print a single result.

    Args:
        result: The result to format and print
        config: Output configuration
    """
    pass


class OutputCapture:
    """
    Context manager for capturing and formatting agent output.

    This can be used to wrap agent execution and automatically
    format the output.
    """

    def __init__(self, config: Optional[OutputConfig] = None):
        """
        Initialize output capture.

        Args:
            config: Output configuration
        """
        pass

    async def __aenter__(self) -> "OutputCapture":
        """Enter async context."""
        pass

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Exit async context."""
        pass

    def capture_event(self, event: AgentOutputEvent) -> None:
        """Capture an event."""
        pass

    def get_output(self) -> AgentOutput:
        """Get the captured output."""
        pass