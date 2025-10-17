# mcp_use/managers/tools/get_active_server.py
from typing_extensions import deprecated

from mcp_use.agents.managers.tools.get_active_server import GetActiveServerTool as _GetActiveServerTool


@deprecated("Use mcp_use.agents.managers.tools.get_active_server.GetActiveServerTool")
class GetActiveServerTool(_GetActiveServerTool): ...
