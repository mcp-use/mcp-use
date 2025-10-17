# mcp_use/managers/tools/list_servers_tool.py
from typing_extensions import deprecated

from mcp_use.agents.managers.tools.list_servers_tool import ListServersTool as _ListServersTool


@deprecated("Use mcp_use.agents.managers.tools.list_servers_tool.ListServersTool")
class ListServersTool(_ListServersTool): ...
