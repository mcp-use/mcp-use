# mcp_use/session.py
from typing_extensions import deprecated

from mcp_use.client.session import MCPSession as _MCPSession


@deprecated("Use mcp_use.client.session.MCPSession")
class MCPSession(_MCPSession): ...
