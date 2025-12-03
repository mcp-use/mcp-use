# mcp_use/session.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.session import MCPSession as _MCPSession

warnings.warn(
    "mcp_use.session.MCPSession is deprecated. "
    "Use mcp_use.client.session.MCPSession. "
    "This import will be removed in version 2.0.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.session.MCPSession")
class MCPSession(_MCPSession): ...
