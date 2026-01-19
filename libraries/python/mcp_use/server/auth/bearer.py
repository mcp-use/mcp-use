"""Bearer token authentication provider for mcp-use server."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import AccessToken


class BearerAuthProvider(ABC):
    """Base class for bearer token authentication.

    Implement this class to validate bearer tokens from the Authorization header.
    Only requires implementing `verify_token()` - no OAuth complexity.

    Example:
        ```python
        from mcp_use.server import MCPServer, BearerAuthProvider, AccessToken

        class MyAuthProvider(BearerAuthProvider):
            async def verify_token(self, token: str) -> AccessToken | None:
                user = await my_auth_service.validate(token)
                if not user:
                    return None
                return AccessToken(
                    token=token,
                    claims={"email": user.email, "sub": user.id},
                )

        server = MCPServer(name="my-server", auth=MyAuthProvider())
        ```
    """

    @abstractmethod
    async def verify_token(self, token: str) -> AccessToken | None:
        """Verify a bearer token and return user information.

        Args:
            token: The Bearer token from the Authorization header

        Returns:
            AccessToken with user claims if valid, None if invalid/expired
        """
        pass
