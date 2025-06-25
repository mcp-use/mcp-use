"""MCP-use exceptions."""


class MCPError(Exception):
    """Base exception for MCP-use."""

    pass


class AuthenticationError(MCPError):
    """Authentication-related errors."""

    pass


class ConnectionError(MCPError):
    """Connection-related errors."""

    pass


class ConfigurationError(MCPError):
    """Configuration-related errors."""

    pass
