# mcp_use/client.py
from typing_extensions import deprecated

from mcp_use.client.client import MCPClient as _MCPClient


@deprecated("Use mcp_use.client.client.MCPClient")
class MCPClient(_MCPClient): ...
