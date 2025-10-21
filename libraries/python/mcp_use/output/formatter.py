"""
Output formatters for MCP agent responses.

This module provides functions to format agent outputs
using the rich library for terminal display.
"""

from typing import Any

from .config import OutputConfig
from .printer import PanelPrinter


def format_output(
    query: str,
    response: Any,
    execution_time_s: float | None = None,
    steps: list[dict[str, Any]] | None = None,
    config: OutputConfig | None = None,
) -> None:
    """
    Format and display query and response in clean panels.

    Args:
        query: The user's query/message
        response: The agent's response
        execution_time_s: Execution time in seconds
        steps: Optional reasoning steps to display
        config: Output configuration
    """
    config = config or OutputConfig()
    printer = PanelPrinter(config)

    printer.print_message_and_response(
        query=query,
        response=response,
        execution_time_s=execution_time_s,
        steps=steps if config.show_steps else None,
    )


def format_error(
    query: str,
    error: str,
    config: OutputConfig | None = None,
) -> None:
    """
    Format and display an error.

    Args:
        query: The user's query
        error: The error message
        config: Output configuration
    """
    config = config or OutputConfig()
    printer = PanelPrinter(config)

    printer.print_error(query=query, error=error)
