"""Authentication middleware for mcp-use server."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .dependencies import set_access_token

if TYPE_CHECKING:
    from starlette.types import ASGIApp

    from .bearer import BearerAuthProvider

logger = logging.getLogger(__name__)


class AuthMiddleware(BaseHTTPMiddleware):
    """Middleware that validates Bearer tokens on MCP endpoints.

    This middleware:
    1. Extracts Bearer token from Authorization header
    2. Validates token with the configured BearerAuthProvider
    3. Sets the AccessToken in context for tools to access via get_access_token()
    4. Returns 401 for unauthenticated requests to protected paths
    """

    def __init__(
        self,
        app: ASGIApp,
        auth_provider: BearerAuthProvider,
        exclude_paths: list[str] | None = None,
        protected_paths: list[str] | None = None,
    ):
        """Initialize auth middleware.

        Args:
            app: The ASGI application
            auth_provider: Provider to validate tokens
            exclude_paths: Paths to exclude from authentication
            protected_paths: Paths that require authentication (default: /mcp)
        """
        super().__init__(app)
        self.auth_provider = auth_provider
        self.exclude_paths = exclude_paths or [
            "/health",
            "/docs",
            "/inspector",
            "/openmcp.json",
        ]
        self.protected_paths = protected_paths or ["/mcp"]

    def _is_protected_path(self, path: str) -> bool:
        """Check if the path requires authentication."""
        for protected_path in self.protected_paths:
            if path == protected_path or path.startswith(f"{protected_path}/"):
                return True
        return False

    async def dispatch(self, request: Request, call_next) -> Response:
        """Process the request and validate authentication."""
        # Always allow OPTIONS requests (CORS preflight)
        if request.method == "OPTIONS":
            set_access_token(None)
            return await call_next(request)

        # Check if path should be excluded from auth
        path = request.url.path
        for exclude_path in self.exclude_paths:
            if path == exclude_path or path.startswith(f"{exclude_path}/"):
                set_access_token(None)
                return await call_next(request)

        # Check if this is a protected path
        is_protected = self._is_protected_path(path)

        # Extract Bearer token from Authorization header
        auth_header = request.headers.get("Authorization", "")

        if auth_header.startswith("Bearer "):
            token = auth_header[7:]

            try:
                # Validate token with provider
                access_token = await self.auth_provider.verify_token(token)

                if access_token is not None:
                    set_access_token(access_token)
                    logger.debug("Authenticated request")
                else:
                    # Token validation failed
                    set_access_token(None)
                    if is_protected:
                        logger.debug("Token validation failed for protected path")
                        return JSONResponse(
                            status_code=401,
                            content={
                                "error": "invalid_token",
                                "error_description": "Token is invalid or expired",
                            },
                            headers={"WWW-Authenticate": "Bearer"},
                        )

            except Exception:
                # Catch exceptions from user-implemented verify_token()
                # Log for debugging but return 401 to avoid leaking error details
                logger.warning("Token validation raised an exception", exc_info=True)
                set_access_token(None)
                if is_protected:
                    return JSONResponse(
                        status_code=401,
                        content={
                            "error": "invalid_token",
                            "error_description": "Token validation failed",
                        },
                        headers={"WWW-Authenticate": "Bearer"},
                    )
        else:
            # No auth header present
            set_access_token(None)
            if is_protected:
                logger.debug(f"Unauthenticated request to protected path: {path}")
                return JSONResponse(
                    status_code=401,
                    content={
                        "error": "unauthorized",
                        "error_description": "Authentication required",
                    },
                    headers={"WWW-Authenticate": "Bearer"},
                )

        response = await call_next(request)
        return response
