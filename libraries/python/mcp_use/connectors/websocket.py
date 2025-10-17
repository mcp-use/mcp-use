# mcp_use/connectors/websocket.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.connectors.websocket import WebSocketConnector as _WebSocketConnector

warnings.warn(
    "mcp_use.connectors.websocket is deprecated. "
    "Use mcp_use.client.connectors.websocket. "
    "This import will be removed in version 1.4.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.connectors.websocket.WebSocketConnector")
class WebSocketConnector(_WebSocketConnector): ...
