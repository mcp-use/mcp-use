# mcp_use/connectors/__init__.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.connectors import (
    BaseConnector as _BaseConnector,
)
from mcp_use.client.connectors import (
    HttpConnector as _HttpConnector,
)
from mcp_use.client.connectors import (
    SandboxConnector as _SandboxConnector,
)
from mcp_use.client.connectors import (
    StdioConnector as _StdioConnector,
)
from mcp_use.client.connectors import (
    WebSocketConnector as _WebSocketConnector,
)

warnings.warn(
    "mcp_use.connectors is deprecated. Use mcp_use.client.connectors. This import will be removed in version 2.0.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.connectors.BaseConnector")
class BaseConnector(_BaseConnector): ...


@deprecated("Use mcp_use.client.connectors.StdioConnector")
class StdioConnector(_StdioConnector): ...


@deprecated("Use mcp_use.client.connectors.HttpConnector")
class HttpConnector(_HttpConnector): ...


@deprecated("Use mcp_use.client.connectors.WebSocketConnector")
class WebSocketConnector(_WebSocketConnector): ...


@deprecated("Use mcp_use.client.connectors.SandboxConnector")
class SandboxConnector(_SandboxConnector): ...
