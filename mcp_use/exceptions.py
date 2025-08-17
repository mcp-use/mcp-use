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
