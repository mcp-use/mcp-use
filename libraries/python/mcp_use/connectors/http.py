# mcp_use/connectors/http.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.connectors.http import HttpConnector as _HttpConnector

warnings.warn(
    "mcp_use.connectors.http is deprecated. "
    "Use mcp_use.client.connectors.http. "
    "This import will be removed in version 2.0.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.connectors.http.HttpConnector")
class HttpConnector(_HttpConnector): ...
