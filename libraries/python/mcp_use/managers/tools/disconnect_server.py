# mcp_use/managers/tools/disconnect_server.py
from typing_extensions import deprecated

from mcp_use.agents.managers.tools.disconnect_server import DisconnectServerTool as _DisconnectServerTool


@deprecated("Use mcp_use.agents.managers.tools.disconnect_server.DisconnectServerTool")
class DisconnectServerTool(_DisconnectServerTool): ...
