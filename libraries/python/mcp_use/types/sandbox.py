# mcp_use/types/sandbox.py
from typing_extensions import deprecated

from mcp_use.client.connectors.sandbox import SandboxOptions as _SandboxOptions


@deprecated("Use mcp_use.client.connectors.sandbox.SandboxOptions")
class SandboxOptions(_SandboxOptions): ...
