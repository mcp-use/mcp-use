# mcp_use/auth/bearer.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.auth.bearer import BearerAuth as _BearerAuth

warnings.warn(
    "mcp_use.auth.bearer is deprecated. Use mcp_use.client.auth.bearer. This import will be removed in version 1.4.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.auth.bearer.BearerAuth")
class BearerAuth(_BearerAuth): ...
