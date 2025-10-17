# mcp_use/types/sandbox.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.connectors.sandbox import SandboxOptions as _SandboxOptions

warnings.warn(
    "mcp_use.types.sandbox is deprecated. "
    "Use mcp_use.client.connectors.sandbox. "
    "This import will be removed in version 1.4.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.connectors.sandbox.SandboxOptions")
class SandboxOptions(_SandboxOptions): ...
