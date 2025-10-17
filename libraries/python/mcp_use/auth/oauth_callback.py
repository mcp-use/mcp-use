# mcp_use/auth/oauth_callback.py
from typing_extensions import deprecated

from mcp_use.client.auth.oauth_callback import CallbackResponse as _CallbackResponse
from mcp_use.client.auth.oauth_callback import OAuthCallbackServer as _OAuthCallbackServer


@deprecated("Use mcp_use.client.auth.oauth_callback.OAuthCallbackServer")
class OAuthCallbackServer(_OAuthCallbackServer): ...


@deprecated("Use mcp_use.client.auth.oauth_callback.CallbackResponse")
class CallbackResponse(_CallbackResponse): ...
