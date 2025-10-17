# mcp_use/connectors/sandbox.py
from typing_extensions import deprecated

from mcp_use.client.connectors.sandbox import SandboxConnector as _SandboxConnector


@deprecated("Use mcp_use.client.connectors.sandbox.SandboxConnector")
class SandboxConnector(_SandboxConnector): ...
