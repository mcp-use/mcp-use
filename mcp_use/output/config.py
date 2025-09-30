"""
Configuration for output formatting.

This module provides configuration options for output formatting.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class OutputConfig:
    """Configuration for output formatting."""

    # Display options
    markdown: bool = False
    show_timing: bool = False
    show_metadata: bool = False
    show_steps: bool = True

    # Formatting options
    max_tool_input_length: int = 100
    max_tool_result_length: int = 200
    max_thinking_length: int = 300

    # Color scheme
    tool_call_color: str = "cyan"
    tool_result_color: str = "green"
    thinking_color: str = "yellow"
    error_color: str = "red"
    success_color: str = "green"

    # Table styling
    table_box_style: str = "ROUNDED"
    table_border_color: str = "blue"

    @classmethod
    def from_dict(cls, config: dict) -> "OutputConfig":
        """Create config from dictionary."""
        pass

    def to_dict(self) -> dict:
        """Convert config to dictionary."""
        pass