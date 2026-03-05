"""Authentication support for MCP clients.

Re-exports from ``mcp_use.client.auth`` for ergonomic top-level access::

    from mcp_use.auth import BearerAuth, OAuthAuth
"""

from mcp_use.client.auth.bearer import BearerAuth
from mcp_use.client.auth.oauth import OAuth

# Forward-compatible alias so users can write ``from mcp_use.auth import OAuthAuth``
# even before a dedicated OAuthAuth wrapper class lands (see issue #944).
OAuthAuth = OAuth

__all__ = [
    "BearerAuth",
    "OAuth",
    "OAuthAuth",
]
