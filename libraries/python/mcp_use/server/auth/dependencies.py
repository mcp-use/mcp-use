"""Context helpers for accessing authentication in tools."""

from __future__ import annotations

from contextvars import ContextVar
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import AccessToken

_current_access_token: ContextVar[AccessToken | None] = ContextVar("mcp_use_access_token", default=None)


def get_access_token() -> AccessToken | None:
    """Get the current authenticated user's access token.

    Returns None if the request is not authenticated.

    Example:
        ```python
        from mcp_use.server import get_access_token

        @server.tool()
        def whoami() -> str:
            token = get_access_token()
            if not token:
                return "Not authenticated"
            return f"Hello {token.claims.get('email')}"
        ```
    """
    return _current_access_token.get()


def set_access_token(token: AccessToken | None) -> None:
    """Set the current access token (called by AuthMiddleware)."""
    _current_access_token.set(token)


def require_auth() -> AccessToken:
    """Get the access token or raise ValueError if not authenticated.

    Example:
        ```python
        from mcp_use.server import require_auth

        @server.tool()
        def admin_action() -> str:
            token = require_auth()  # Raises if not authenticated
            if "admin" not in token.scopes:
                return "Admin scope required"
            return "Admin action performed"
        ```
    """
    token = get_access_token()
    if token is None:
        raise ValueError("Authentication required")
    return token
