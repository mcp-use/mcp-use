# mcp_use/managers/__init__.py
from typing_extensions import deprecated

from mcp_use.agents.managers.server_manager import ServerManager as _ServerManager
from mcp_use.agents.managers.tools import (
    ConnectServerTool as _ConnectServerTool,
)
from mcp_use.agents.managers.tools import (
    DisconnectServerTool as _DisconnectServerTool,
)
from mcp_use.agents.managers.tools import (
    GetActiveServerTool as _GetActiveServerTool,
)
from mcp_use.agents.managers.tools import (
    ListServersTool as _ListServersTool,
)
from mcp_use.agents.managers.tools import (
    MCPServerTool as _MCPServerTool,
)
from mcp_use.agents.managers.tools import (
    SearchToolsTool as _SearchToolsTool,
)


@deprecated("Use mcp_use.agents.managers.server_manager.ServerManager")
class ServerManager(_ServerManager): ...


@deprecated("Use mcp_use.agents.managers.tools.MCPServerTool")
class MCPServerTool(_MCPServerTool): ...


@deprecated("Use mcp_use.agents.managers.tools.ConnectServerTool")
class ConnectServerTool(_ConnectServerTool): ...


@deprecated("Use mcp_use.agents.managers.tools.DisconnectServerTool")
class DisconnectServerTool(_DisconnectServerTool): ...


@deprecated("Use mcp_use.agents.managers.tools.GetActiveServerTool")
class GetActiveServerTool(_GetActiveServerTool): ...


@deprecated("Use mcp_use.agents.managers.tools.ListServersTool")
class ListServersTool(_ListServersTool): ...


@deprecated("Use mcp_use.agents.managers.tools.SearchToolsTool")
class SearchToolsTool(_SearchToolsTool): ...
