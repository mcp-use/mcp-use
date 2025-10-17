# mcp_use/client.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.client import MCPClient as _MCPClient

warnings.warn(
    "mcp_use.client.MCPClient is deprecated. "
    "Use mcp_use.client.client.MCPClient. "
    "This import will be removed in version 1.4.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.client.MCPClient")
class MCPClient(_MCPClient): ...
