"""
Output types for MCP agent responses.

This module defines the data structures for agent outputs and events.
"""

import json
from dataclasses import asdict, dataclass, field
from enum import Enum
from time import time
from typing import Any

from pydantic import BaseModel


class EventType(str, Enum):
    """Types of events that can occur during agent execution."""

    AGENT_STARTED = "agent_started"
    AGENT_THINKING = "agent_thinking"
    TOOL_CALL_STARTED = "tool_call_started"
    TOOL_CALL_COMPLETED = "tool_call_completed"
    AGENT_RESPONSE = "agent_response"
    AGENT_COMPLETED = "agent_completed"
    AGENT_ERROR = "agent_error"


@dataclass
class AgentOutputEvent:
    """Represents an event during agent execution."""

    event_type: EventType
    timestamp: int = field(default_factory=lambda: int(time()))
    content: Any | None = None
    metadata: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert event to dictionary.

        Returns:
            Dictionary representation of event.
        """
        result = {
            "event_type": self.event_type.value if isinstance(self.event_type, EventType) else self.event_type,
            "timestamp": self.timestamp,
        }

        if self.content is not None:
            if isinstance(self.content, BaseModel):
                result["content"] = self.content.model_dump(exclude_none=True)
            else:
                result["content"] = self.content

        if self.metadata is not None:
            result["metadata"] = self.metadata

        return result


@dataclass
class AgentOutput:
    """Represents the final output from an agent execution."""

    content: Any | None = None
    content_type: str = "str"
    metadata: dict[str, Any] | None = None
    events: list[AgentOutputEvent] | None = None
    execution_time_ms: int | None = None
    steps_taken: int | None = None
    tools_used: list[str] | None = None
    success: bool = True
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert output to dictionary.

        Returns:
            Dictionary representation of output.
        """
        result = asdict(self)

        # Handle Pydantic models in content
        if self.content is not None and isinstance(self.content, BaseModel):
            result["content"] = self.content.model_dump(exclude_none=True)

        # Handle events list
        if self.events is not None:
            result["events"] = [event.to_dict() for event in self.events]

        # Remove None values for cleaner output
        return {k: v for k, v in result.items() if v is not None}

    def get_content_as_string(self, **kwargs) -> str:
        """Get content as formatted string.

        Args:
            **kwargs: Additional formatting options.

        Returns:
            String representation of content.
        """
        if self.content is None:
            return ""

        if isinstance(self.content, str):
            return self.content

        if isinstance(self.content, BaseModel):
            try:
                return self.content.model_dump_json(exclude_none=True, **kwargs)
            except Exception:
                return str(self.content)

        # Try JSON serialization for other types
        try:
            return json.dumps(self.content, indent=2, **kwargs)
        except (TypeError, ValueError):
            return str(self.content)