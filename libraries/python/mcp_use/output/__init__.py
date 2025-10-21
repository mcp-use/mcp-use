"""
Output formatting for MCP agent responses.
"""

from .config import OutputConfig
from .formatter import format_error, format_output
from .integration import (
    OutputCapture,
    format_and_print_result,
    format_stream_with_panels,
)
from .integration import (
    format_error as integration_format_error,
)
from .printer import PanelPrinter, StreamPrinter

__all__ = [
    "OutputConfig",
    "PanelPrinter",
    "StreamPrinter",
    "format_output",
    "format_error",
    "format_and_print_result",
    "format_stream_with_panels",
    "OutputCapture",
]