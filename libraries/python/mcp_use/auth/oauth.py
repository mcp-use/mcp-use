# mcp_use/auth/oauth.py
from typing_extensions import deprecated

from mcp_use.client.auth.oauth import OAuth as _OAuth


@deprecated("Use mcp_use.client.auth.oauth.OAuth")
class OAuth(_OAuth): ...
