# mcp_use/connectors/sandbox.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.connectors.sandbox import SandboxConnector as _SandboxConnector

warnings.warn(
    "mcp_use.connectors.sandbox is deprecated. "
    "Use mcp_use.client.connectors.sandbox. "
    "This import will be removed in version 1.4.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.connectors.sandbox.SandboxConnector")
class SandboxConnector(_SandboxConnector): ...
