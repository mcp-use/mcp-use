from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


class BaseTelemetryEvent(ABC):
    """Base class for all telemetry events"""

    @property
    @abstractmethod
    def name(self) -> str:
        """Event name for tracking"""
        pass

    @property
    @abstractmethod
    def properties(self) -> dict[str, Any]:
        """Event properties to send with the event"""
        pass


@dataclass
class MCPAgentExecutionEvent(BaseTelemetryEvent):
    """Comprehensive event for tracking complete MCP agent execution"""

    # Execution method and context
    execution_method: str  # "run" or "astream"
    query: str  # The actual user query
    success: bool

    # Agent configuration
    model_provider: str
    model_name: str
    server_count: int
    server_identifiers: list[dict[str, str]]
    total_tools_available: int
    tools_available_names: list[str]
    max_steps_configured: int
    memory_enabled: bool
    use_server_manager: bool

    # Execution PARAMETERS
    max_steps_used: int | None
    manage_connector: bool
    external_history_used: bool

    # Execution results
    steps_taken: int | None = None
    tools_used_count: int | None = None
    tools_used_names: list[str] | None = None
    response: str | None = None  # The actual response
    execution_time_ms: int | None = None
    error_type: str | None = None

    # Context
    conversation_history_length: int | None = None

    @property
    def name(self) -> str:
        return "mcp_agent_execution"

    @property
    def properties(self) -> dict[str, Any]:
        return {
            # Core execution info
            "execution_method": self.execution_method,
            "query": self.query,
            "query_length": len(self.query),
            "success": self.success,
            # Agent configuration
            "model_provider": self.model_provider,
            "model_name": self.model_name,
            "server_count": self.server_count,
            "server_identifiers": self.server_identifiers,
            "total_tools_available": self.total_tools_available,
            "tools_available_names": self.tools_available_names,
            "max_steps_configured": self.max_steps_configured,
            "memory_enabled": self.memory_enabled,
            "use_server_manager": self.use_server_manager,
            # Execution parameters (always include, even if None)
            "max_steps_used": self.max_steps_used,
            "manage_connector": self.manage_connector,
            "external_history_used": self.external_history_used,
            # Execution results (always include, even if None)
            "steps_taken": self.steps_taken,
            "tools_used_count": self.tools_used_count,
            "tools_used_names": self.tools_used_names,
            "response": self.response,
            "response_length": len(self.response) if self.response else None,
            "execution_time_ms": self.execution_time_ms,
            "error_type": self.error_type,
            "conversation_history_length": self.conversation_history_length,
        }


@dataclass
class FeatureUsageEvent(BaseTelemetryEvent):
    """Event for tracking feature usage across the library"""

    feature_name: str
    class_name: str
    method_name: str
    success: bool
    execution_time_ms: int | None = None
    error_type: str | None = None
    additional_properties: dict[str, Any] | None = None

    @property
    def name(self) -> str:
        return "feature_usage"

    @property
    def properties(self) -> dict[str, Any]:
        props = {
            "feature_name": self.feature_name,
            "class_name": self.class_name,
            "method_name": self.method_name,
            "success": self.success,
            "execution_time_ms": self.execution_time_ms,
            "error_type": self.error_type,
        }
        if self.additional_properties:
            props.update(self.additional_properties)
        return props


@dataclass
class CLICommandEvent(BaseTelemetryEvent):
    """Event for tracking CLI command usage"""

    command: str
    success: bool
    execution_time_ms: int | None = None
    error_type: str | None = None
    additional_properties: dict[str, Any] | None = None

    @property
    def name(self) -> str:
        return "cli_command"

    @property
    def properties(self) -> dict[str, Any]:
        props = {
            "command": self.command,
            "success": self.success,
            "execution_time_ms": self.execution_time_ms,
            "error_type": self.error_type,
        }
        if self.additional_properties:
            props.update(self.additional_properties)
        return props
