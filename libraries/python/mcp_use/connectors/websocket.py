# mcp_use/connectors/websocket.py
from typing_extensions import deprecated

from mcp_use.client.connectors.websocket import WebSocketConnector as _WebSocketConnector


@deprecated("Use mcp_use.client.connectors.websocket.WebSocketConnector")
class WebSocketConnector(_WebSocketConnector): ...
