# mcp_use/auth/__init__.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.auth import BearerAuth as _BearerAuth
from mcp_use.client.auth import OAuth as _OAuth

warnings.warn(
    "mcp_use.auth is deprecated. Use mcp_use.client.auth. This import will be removed in version 2.0.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.auth.BearerAuth")
class BearerAuth(_BearerAuth): ...


@deprecated("Use mcp_use.client.auth.OAuth")
class OAuth(_OAuth): ...
