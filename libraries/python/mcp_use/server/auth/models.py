"""Authentication models for mcp-use server."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class AuthenticationError(Exception):
    """Raised when authentication is required but not provided."""

    pass


class AccessToken(BaseModel):
    """Validated access token with user claims.

    Attributes:
        token: The original bearer token
        claims: User information (email, sub, name, etc.)
        scopes: Optional list of permissions/scopes

    Example:
        ```python
        from mcp_use.server.auth import get_access_token

        @server.tool()
        def whoami() -> str:
            token = get_access_token()
            if token:
                return f"Hello {token.claims.get('email')}"
            return "Not authenticated"
        ```
    """

    token: str
    claims: dict[str, Any] = Field(default_factory=dict)
    scopes: list[str] = Field(default_factory=list)
