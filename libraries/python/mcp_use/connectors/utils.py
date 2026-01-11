# mcp_use/connectors/utils.py
import warnings
from typing import Any

from typing_extensions import deprecated

from mcp_use.client.connectors.utils import is_stdio_server as _is_stdio_server

warnings.warn(
    "mcp_use.connectors.utils is deprecated. "
    "Use mcp_use.client.connectors.utils. "
    "This import will be removed in version 2.0.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.connectors.utils.is_stdio_server")
def is_stdio_server(server_config: dict[str, Any]) -> bool:
    return _is_stdio_server(server_config)
