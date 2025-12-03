# mcp_use/task_managers/websocket.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.task_managers.websocket import WebSocketConnectionManager as _WebSocketConnectionManager

warnings.warn(
    "mcp_use.task_managers.websocket is deprecated. "
    "Use mcp_use.client.task_managers.websocket. "
    "This import will be removed in version 2.0.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.task_managers.websocket.WebSocketConnectionManager")
class WebSocketConnectionManager(_WebSocketConnectionManager): ...
