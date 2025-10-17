# mcp_use/managers/server_manager.py
from typing_extensions import deprecated

from mcp_use.agents.managers.server_manager import ServerManager as _ServerManager


@deprecated("Use mcp_use.agents.managers.server_manager.ServerManager")
class ServerManager(_ServerManager): ...
