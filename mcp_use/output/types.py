"""
Output types for MCP agent responses.

This module defines the data structures for agent outputs and events.
"""

from dataclasses import dataclass, field
from enum import Enum
from time import time
from typing import Any, Optional

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
    content: Optional[Any] = None
    metadata: Optional[dict[str, Any]] = None

    def to_dict(self) -> dict[str, Any]:
        """Convert event to dictionary."""
        pass


@dataclass
class AgentOutput:
    """Represents the final output from an agent execution."""

    content: Optional[Any] = None
    content_type: str = "str"
    metadata: Optional[dict[str, Any]] = None
    events: Optional[list[AgentOutputEvent]] = None
    execution_time_ms: Optional[int] = None
    steps_taken: Optional[int] = None
    tools_used: Optional[list[str]] = None
    success: bool = True
    error: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        """Convert output to dictionary."""
        pass

    def get_content_as_string(self, **kwargs) -> str:
        """Get content as formatted string."""
        pass