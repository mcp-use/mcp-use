# mcp_use/auth/bearer.py
from typing_extensions import deprecated

from mcp_use.client.auth.bearer import BearerAuth as _BearerAuth


@deprecated("Use mcp_use.client.auth.bearer.BearerAuth")
class BearerAuth(_BearerAuth): ...
