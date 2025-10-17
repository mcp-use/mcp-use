# mcp_use/task_managers/websocket.py
from typing_extensions import deprecated

from mcp_use.client.task_managers.websocket import WebSocketConnectionManager as _WebSocketConnectionManager


@deprecated("Use mcp_use.client.task_managers.websocket.WebSocketConnectionManager")
class WebSocketConnectionManager(_WebSocketConnectionManager): ...
