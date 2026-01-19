"""Bearer token authentication for mcp-use server.

Example:
    ```python
    from mcp_use.server import MCPServer, BearerAuthProvider, AccessToken, get_access_token

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

    @server.tool()
    async def whoami() -> str:
        token = get_access_token()
        if not token:
            return "Not authenticated"
        return f"Hello {token.claims.get('email')}"
    ```
"""

from .bearer import BearerAuthProvider
from .dependencies import get_access_token, require_auth, set_access_token
from .middleware import AuthMiddleware
from .models import AccessToken

__all__ = [
    "BearerAuthProvider",
    "AccessToken",
    "AuthMiddleware",
    "get_access_token",
    "set_access_token",
    "require_auth",
]
