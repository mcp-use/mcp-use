# mcp_use/auth/oauth_callback.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.auth.oauth_callback import CallbackResponse as _CallbackResponse
from mcp_use.client.auth.oauth_callback import OAuthCallbackServer as _OAuthCallbackServer

warnings.warn(
    "mcp_use.auth.oauth_callback is deprecated. "
    "Use mcp_use.client.auth.oauth_callback. "
    "This import will be removed in version 2.0.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.auth.oauth_callback.OAuthCallbackServer")
class OAuthCallbackServer(_OAuthCallbackServer): ...


@deprecated("Use mcp_use.client.auth.oauth_callback.CallbackResponse")
class CallbackResponse(_CallbackResponse): ...
