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
class MCPAgentQueryEvent(BaseTelemetryEvent):
    """Event for tracking MCP agent query usage"""

    query_type: str
    server_count: int
    tools_used: int

    @property
    def name(self) -> str:
        return "mcp_agent_query"

    @property
    def properties(self) -> dict[str, Any]:
        return {
            "query_type": self.query_type,
            "server_count": self.server_count,
            "tools_used": self.tools_used,
        }


@dataclass
class ServerConnectionEvent(BaseTelemetryEvent):
    """Event for tracking MCP server connection attempts"""

    server_type: str
    connection_type: str
    success: bool

    @property
    def name(self) -> str:
        return "server_connection"

    @property
    def properties(self) -> dict[str, Any]:
        return {
            "server_type": self.server_type,
            "connection_type": self.connection_type,
            "success": self.success,
        }


@dataclass
class ToolUsageEvent(BaseTelemetryEvent):
    """Event for tracking individual MCP tool usage"""

    tool_name: str
    server_name: str

    @property
    def name(self) -> str:
        return "tool_usage"

    @property
    def properties(self) -> dict[str, Any]:
        return {"tool_name": self.tool_name, "server_name": self.server_name}


@dataclass
class SessionStartEvent(BaseTelemetryEvent):
    """Event for tracking session starts"""

    client_version: str
    python_version: str
    platform: str

    @property
    def name(self) -> str:
        return "session_start"

    @property
    def properties(self) -> dict[str, Any]:
        return {
            "client_version": self.client_version,
            "python_version": self.python_version,
            "platform": self.platform,
        }


@dataclass
class SessionEndEvent(BaseTelemetryEvent):
    """Event for tracking session ends"""

    duration_seconds: int
    total_queries: int
    total_servers_connected: int

    @property
    def name(self) -> str:
        return "session_end"

    @property
    def properties(self) -> dict[str, Any]:
        return {
            "duration_seconds": self.duration_seconds,
            "total_queries": self.total_queries,
            "total_servers_connected": self.total_servers_connected,
        }
