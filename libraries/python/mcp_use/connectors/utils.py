# mcp_use/connectors/utils.py
from typing import Any

from typing_extensions import deprecated

from mcp_use.client.connectors.utils import is_stdio_server as _is_stdio_server


@deprecated("Use mcp_use.client.connectors.utils.is_stdio_server")
def is_stdio_server(server_config: dict[str, Any]) -> bool:
    return _is_stdio_server(server_config)
