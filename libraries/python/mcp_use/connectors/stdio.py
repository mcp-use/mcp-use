# mcp_use/connectors/stdio.py
from typing_extensions import deprecated

from mcp_use.client.connectors.stdio import StdioConnector as _StdioConnector


@deprecated("Use mcp_use.client.connectors.stdio.StdioConnector")
class StdioConnector(_StdioConnector): ...
