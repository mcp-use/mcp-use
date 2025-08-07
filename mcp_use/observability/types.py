"""
Types and configuration classes for observability providers.
"""

from abc import ABC, abstractmethod
from typing import Any, Literal


class BaseObservabilityConfig(ABC):
    """Base class for observability provider configurations."""

    @abstractmethod
    def is_enabled(self) -> bool:
        """Check if observability is enabled."""
        pass


class LangfuseObservabilityConfig(BaseObservabilityConfig):
    """Configuration for Langfuse observability."""

    def __init__(
        self,
        enabled: bool = True,
        trace_level: Literal["basic", "detailed", "verbose"] = "basic",
        capture_tool_inputs: bool = True,
        capture_tool_outputs: bool = True,
        capture_context: bool = True,
        filter_sensitive_data: bool = True,
        session_id: str | None = None,
        user_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ):
        """Initialize Langfuse observability configuration.

        Args:
            enabled: Whether Langfuse tracing is enabled
            trace_level: Level of detail for tracing (basic, detailed, verbose)
            capture_tool_inputs: Whether to capture tool inputs
            capture_tool_outputs: Whether to capture tool outputs
            capture_context: Whether to capture conversation context
            filter_sensitive_data: Whether to filter sensitive data from traces
            session_id: Optional session ID for grouping traces
            user_id: Optional user ID for user-specific traces
            metadata: Optional additional metadata for traces
        """
        self.enabled = enabled
        self.trace_level = trace_level
        self.capture_tool_inputs = capture_tool_inputs
        self.capture_tool_outputs = capture_tool_outputs
        self.capture_context = capture_context
        self.filter_sensitive_data = filter_sensitive_data
        self.session_id = session_id
        self.user_id = user_id
        self.metadata = (metadata or {}).copy()

    def is_enabled(self) -> bool:
        """Check if Langfuse observability is enabled."""
        return self.enabled

    def to_dict(self) -> dict[str, Any]:
        """Convert configuration to dictionary format."""
        return {
            "enabled": self.enabled,
            "traceLevel": self.trace_level,
            "captureToolInputs": self.capture_tool_inputs,
            "captureToolOutputs": self.capture_tool_outputs,
            "captureContext": self.capture_context,
            "filterSensitiveData": self.filter_sensitive_data,
            "sessionId": self.session_id,
            "userId": self.user_id,
            "metadata": self.metadata,
        }


# Type alias for observability configuration
LangchainObservability = dict[str, BaseObservabilityConfig]

# For convenience, also support dict-based configuration
ObservabilityInput = dict[str, BaseObservabilityConfig | dict[str, Any]] | None
