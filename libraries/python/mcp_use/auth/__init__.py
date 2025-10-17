# mcp_use/auth/__init__.py
from typing_extensions import deprecated

from mcp_use.client.auth import BearerAuth as _BearerAuth
from mcp_use.client.auth import OAuth as _OAuth


@deprecated("Use mcp_use.client.auth.BearerAuth")
class BearerAuth(_BearerAuth): ...


@deprecated("Use mcp_use.client.auth.OAuth")
class OAuth(_OAuth): ...
