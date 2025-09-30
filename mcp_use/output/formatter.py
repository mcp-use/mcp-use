"""
Output formatters for MCP agent responses.

This module provides functions to format agent outputs
using the rich library for terminal display.
"""

from collections.abc import AsyncIterable, Iterable
from typing import Any, Union

from .types import AgentOutput, AgentOutputEvent


def format_output(
    output: Union[AgentOutput, str, Any],
    markdown: bool = False,
    show_metadata: bool = False,
    show_timing: bool = False,
) -> None:
    """
    Format and display a single agent output.

    Args:
        output: The agent output to format
        markdown: Whether to render string content as markdown
        show_metadata: Whether to show metadata information
        show_timing: Whether to show timing information
    """
    pass


async def format_stream(
    stream: Union[AsyncIterable[AgentOutputEvent], Iterable[AgentOutputEvent]],
    markdown: bool = False,
    show_steps: bool = True,
    show_timing: bool = False,
) -> None:
    """
    Format and display a stream of agent events with live updates.

    Args:
        stream: The stream of events to format
        markdown: Whether to render string content as markdown
        show_steps: Whether to show intermediate steps
        show_timing: Whether to show timing information
    """
    pass


def _format_tool_call(tool_name: str, tool_input: dict[str, Any]) -> str:
    """Format a tool call for display."""
    pass


def _format_tool_result(tool_name: str, result: Any) -> str:
    """Format a tool result for display."""
    pass


def _format_thinking(content: str, max_length: int = 300) -> str:
    """Format agent thinking/reasoning for display."""
    pass


def _format_error(error: str) -> str:
    """Format an error message for display."""
    pass


def _format_metadata(metadata: dict[str, Any]) -> str:
    """Format metadata information for display."""
    pass