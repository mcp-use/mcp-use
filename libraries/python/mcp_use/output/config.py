"""
Configuration for output formatting.

This module provides configuration options for output formatting.
"""

from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class OutputConfig:
    """Configuration for output formatting."""

    # Display options
    show_message: bool = True  # Always show query/message panel
    show_timing: bool = True  # Show timing in response title
    show_steps: bool = False  # Optional: show intermediate reasoning steps
    markdown: bool = False  # Render content as markdown

    # Truncation
    max_stream_preview_length: int = 500  # Brief preview during streaming
    max_step_display_length: int = 200  # Brief step summaries
    max_final_output_length: int | None = None  # No limit for final output

    # Panel styling
    message_border_style: str = "cyan"  # Cyan for user message
    response_border_style: str = "blue"  # Blue for agent response
    step_border_style: str = "green"  # Green for reasoning steps
    error_border_style: str = "red"  # Red for errors

    # Box styles
    message_box_style: str = "HEAVY"  # Heavy/double for message
    response_box_style: str = "ROUNDED"  # Rounded for response
    step_box_style: str = "ROUNDED"  # Rounded for steps

    @classmethod
    def from_dict(cls, config: dict[str, Any]) -> "OutputConfig":
        """Create config from dictionary.

        Args:
            config: Dictionary with configuration values.

        Returns:
            OutputConfig instance.
        """
        # Filter to only valid fields
        valid_fields = {k: v for k, v in config.items() if k in cls.__dataclass_fields__}
        return cls(**valid_fields)

    def to_dict(self) -> dict[str, Any]:
        """Convert config to dictionary.

        Returns:
            Dictionary representation of config.
        """
        return asdict(self)

    @classmethod
    def disabled(cls) -> "OutputConfig":
        """Create a config with all formatting disabled.

        Returns:
            OutputConfig with minimal formatting.
        """
        return cls(
            show_message=False,
            show_timing=False,
            show_steps=False,
        )