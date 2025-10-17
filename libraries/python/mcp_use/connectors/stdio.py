# mcp_use/connectors/stdio.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.connectors.stdio import StdioConnector as _StdioConnector

warnings.warn(
    "mcp_use.connectors.stdio is deprecated. "
    "Use mcp_use.client.connectors.stdio. "
    "This import will be removed in version 1.4.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.connectors.stdio.StdioConnector")
class StdioConnector(_StdioConnector): ...
