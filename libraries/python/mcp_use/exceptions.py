# mcp_use/exceptions.py
from typing_extensions import deprecated

from mcp_use.client.exceptions import (
    ConfigurationError as _ConfigurationError,
)
from mcp_use.client.exceptions import (
    ConnectionError as _ConnectionError,
)
from mcp_use.client.exceptions import (
    MCPError as _MCPError,
)
from mcp_use.client.exceptions import (
    OAuthAuthenticationError as _OAuthAuthenticationError,
)
from mcp_use.client.exceptions import (
    OAuthDiscoveryError as _OAuthDiscoveryError,
)


@deprecated("Use mcp_use.client.exceptions.MCPError")
class MCPError(_MCPError): ...


@deprecated("Use mcp_use.client.exceptions.OAuthDiscoveryError")
class OAuthDiscoveryError(_OAuthDiscoveryError): ...


@deprecated("Use mcp_use.client.exceptions.OAuthAuthenticationError")
class OAuthAuthenticationError(_OAuthAuthenticationError): ...


@deprecated("Use mcp_use.client.exceptions.ConnectionError")
class ConnectionError(_ConnectionError): ...


@deprecated("Use mcp_use.client.exceptions.ConfigurationError")
class ConfigurationError(_ConfigurationError): ...
