# mcp_use/connectors/base.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.connectors.base import BaseConnector as _BaseConnector

warnings.warn(
    "mcp_use.connectors.base is deprecated. "
    "Use mcp_use.client.connectors.base. "
    "This import will be removed in version 1.4.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.connectors.base.BaseConnector")
class BaseConnector(_BaseConnector): ...
