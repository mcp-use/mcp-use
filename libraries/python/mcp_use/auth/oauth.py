# mcp_use/auth/oauth.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.auth.oauth import OAuth as _OAuth

warnings.warn(
    "mcp_use.auth.oauth is deprecated. Use mcp_use.client.auth.oauth. This import will be removed in version 1.4.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.auth.oauth.OAuth")
class OAuth(_OAuth): ...
