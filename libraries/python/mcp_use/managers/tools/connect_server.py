# mcp_use/managers/tools/connect_server.py
from typing_extensions import deprecated

from mcp_use.agents.managers.tools.connect_server import ConnectServerTool as _ConnectServerTool


@deprecated("Use mcp_use.agents.managers.tools.connect_server.ConnectServerTool")
class ConnectServerTool(_ConnectServerTool): ...
