"""Manufact analytics for Python MCP servers.

.. code-block:: python

    from fastmcp import FastMCP
    from mcp_use_analytics import instrument

    mcp = FastMCP("demo")
    instrument(mcp)  # reads MANUFACT_ANALYTICS_KEY

See :func:`instrument` for the options and the README for each framework.
"""

from ._actor import token_identity_hash
from ._instrument import flush, instrument, shutdown
from ._redact import redact_payload
from ._types import Identity, PayloadContext, RequestInfo
from ._version import __version__

__all__ = [
    "Identity",
    "PayloadContext",
    "RequestInfo",
    "__version__",
    "flush",
    "instrument",
    "redact_payload",
    "shutdown",
    "token_identity_hash",
]
