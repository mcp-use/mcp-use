"""MCP-use exceptions."""


class MCPError(Exception):
    """Base exception for MCP-use."""

    pass


class OAuthDiscoveryError(MCPError):
    """OAuth discovery auth metadata error"""

    pass


class OAuthAuthenticationError(MCPError):
    """OAuth authentication-related errors"""

    pass


class ConnectionError(MCPError):
    """Connection-related errors."""

    pass


class ConfigurationError(MCPError):
    """Configuration-related errors."""

    pass


class ToolNotFoundError(MCPError):
    """Raised when a requested tool is not found."""

    pass


class ToolNameCollisionError(MCPError):
    """Raised when there is a name collision between tools."""

    pass
