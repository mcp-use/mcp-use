# mcp_use/managers/server_manager.py
import warnings

from typing_extensions import deprecated

from mcp_use.agents.managers.server_manager import ServerManager as _ServerManager

warnings.warn(
    "mcp_use.managers.server_manager is deprecated. "
    "Use mcp_use.agents.managers.server_manager. "
    "This import will be removed in version 1.4.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.agents.managers.server_manager.ServerManager")
class ServerManager(_ServerManager): ...
