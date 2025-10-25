"""
Integration helpers for connecting output formatting with MCPAgent.

This module provides helper functions and decorators to seamlessly
integrate pretty printing into agent run() and stream() methods.
"""

from collections.abc import AsyncGenerator
from typing import Any

from .config import OutputConfig
from .printer import PanelPrinter, StreamPrinter


def format_and_print_result(
    query: str,
    result: Any,
    execution_time_ms: int | None = None,
    steps: list[dict[str, Any]] | None = None,
    config: OutputConfig | None = None,
) -> None:
    """
    Format and print query and result in clean panels (for run()).

    Args:
        query: User's query/message
        result: Agent's result
        execution_time_ms: Execution time in milliseconds
        steps: Optional reasoning steps
        config: Output configuration
    """
    config = config or OutputConfig()
    printer = PanelPrinter(config)

    # Convert execution time to seconds
    execution_time_s = None
    if execution_time_ms is not None:
        execution_time_s = execution_time_ms / 1000.0

    printer.print_message_and_response(
        query=query,
        response=result,
        execution_time_s=execution_time_s,
        steps=steps if config.show_steps else None,
    )


def format_error(
    query: str,
    error: str,
    config: OutputConfig | None = None,
) -> None:
    """
    Format and print error in a panel.

    Args:
        query: User's query that caused the error
        error: Error message
        config: Output configuration
    """
    config = config or OutputConfig()
    printer = PanelPrinter(config)
    printer.print_error(error=error, query=query)


async def format_stream_with_panels(
    query: str,
    stream: AsyncGenerator,
    config: OutputConfig | None = None,
    stream_intermediate_steps: bool = False,
) -> AsyncGenerator:
    """
    Format agent stream with live panel updates (for stream()).

    Args:
        query: User's query/message
        stream: Agent's stream generator
        config: Output configuration
        stream_intermediate_steps: Whether to show steps during streaming

    Yields:
        Original stream items (passthrough for backward compatibility)
    """
    config = config or OutputConfig()
    printer = StreamPrinter(config)

    # Display panels in real-time while consuming the stream
    final_result = await printer.run_with_panels(
        query=query,
        agent_stream=stream,
        stream_intermediate_steps=stream_intermediate_steps,
    )

    # Yield the final result for backward compatibility
    if final_result is not None:
        yield final_result


class OutputCapture:
    """
    Context manager for capturing agent execution metadata.

    This can be used to track execution time and collect steps.
    """

    def __init__(self):
        """Initialize output capture."""
        self.start_time: float | None = None
        self.end_time: float | None = None
        self.execution_time_ms: int | None = None
        self.steps: list[dict[str, Any]] = []

    async def __aenter__(self) -> "OutputCapture":
        """Enter async context."""
        from time import time

        self.start_time = time()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Exit async context."""
        from time import time

        self.end_time = time()
        if self.start_time is not None:
            self.execution_time_ms = int((self.end_time - self.start_time) * 1000)

    def add_step(self, step: dict[str, Any]) -> None:
        """Add a reasoning step."""
        self.steps.append(step)

    def get_execution_time_ms(self) -> int | None:
        """Get execution time in milliseconds."""
        return self.execution_time_ms

    def get_steps(self) -> list[dict[str, Any]]:
        """Get collected steps."""
        return self.steps
