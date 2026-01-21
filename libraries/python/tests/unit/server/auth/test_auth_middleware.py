"""Unit tests for AuthMiddleware."""

import pytest

# Skip entire module if TestClient can't be imported (httpx version compatibility)
try:
    from starlette.testclient import TestClient
except (ImportError, AttributeError):
    pytest.skip("starlette.testclient requires newer httpx version", allow_module_level=True)

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from mcp_use.server.auth import AccessToken, AuthMiddleware, BearerAuthProvider, get_access_token
from mcp_use.server.auth.dependencies import set_access_token


class MockAuthProvider(BearerAuthProvider):
    """Mock auth provider for testing."""

    def __init__(self, valid_tokens: dict[str, dict] | None = None):
        self.valid_tokens = valid_tokens or {"valid-token": {"email": "test@example.com"}}

    async def verify_token(self, token: str) -> AccessToken | None:
        if token in self.valid_tokens:
            return AccessToken(token=token, claims=self.valid_tokens[token])
        return None


def create_test_app(auth_provider: BearerAuthProvider) -> Starlette:
    """Create a test Starlette app with auth middleware."""

    async def mcp_endpoint(request: Request) -> JSONResponse:
        token = get_access_token()
        if token:
            return JSONResponse({"authenticated": True, "claims": token.claims})
        return JSONResponse({"authenticated": False})

    async def health_endpoint(request: Request) -> JSONResponse:
        return JSONResponse({"status": "ok"})

    async def docs_endpoint(request: Request) -> JSONResponse:
        return JSONResponse({"docs": "here"})

    app = Starlette(
        routes=[
            Route("/mcp", mcp_endpoint, methods=["GET", "POST"]),
            Route("/mcp/messages", mcp_endpoint, methods=["POST"]),
            Route("/health", health_endpoint, methods=["GET"]),
            Route("/docs", docs_endpoint, methods=["GET"]),
        ]
    )

    app.add_middleware(AuthMiddleware, auth_provider=auth_provider)
    return app


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def auth_provider():
    """Default mock auth provider with a single valid token."""
    return MockAuthProvider()


@pytest.fixture
def client(auth_provider):
    """Test client with default auth provider."""
    app = create_test_app(auth_provider)
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def reset_access_token():
    """Reset access token before and after each test."""
    set_access_token(None)
    yield
    set_access_token(None)


# ============================================================================
# Tests
# ============================================================================


class TestAuthMiddleware401Responses:
    """Test that AuthMiddleware returns proper 401 responses."""

    def test_missing_token_returns_401(self, client):
        """Request without Authorization header returns 401."""
        response = client.post("/mcp")

        assert response.status_code == 401
        assert response.json()["error"] == "unauthorized"
        assert "WWW-Authenticate" in response.headers
        assert response.headers["WWW-Authenticate"] == "Bearer"

    def test_invalid_token_returns_401(self, client):
        """Request with invalid token returns 401."""
        response = client.post("/mcp", headers={"Authorization": "Bearer invalid-token"})

        assert response.status_code == 401
        assert response.json()["error"] == "invalid_token"
        assert "WWW-Authenticate" in response.headers

    def test_malformed_auth_header_returns_401(self, client):
        """Request with malformed Authorization header returns 401."""
        # No "Bearer " prefix
        response = client.post("/mcp", headers={"Authorization": "valid-token"})
        assert response.status_code == 401

    def test_valid_token_returns_200(self, client):
        """Request with valid token proceeds normally."""
        response = client.post("/mcp", headers={"Authorization": "Bearer valid-token"})

        assert response.status_code == 200
        data = response.json()
        assert data["authenticated"] is True
        assert data["claims"]["email"] == "test@example.com"


class TestAuthMiddlewarePathExclusion:
    """Test that certain paths are excluded from auth."""

    def test_health_endpoint_excluded(self, client):
        """Health endpoint doesn't require auth."""
        response = client.get("/health")

        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_docs_endpoint_excluded(self, client):
        """Docs endpoint doesn't require auth."""
        response = client.get("/docs")

        assert response.status_code == 200

    def test_mcp_subpaths_require_auth(self, client):
        """/mcp/* paths require auth."""
        response = client.post("/mcp/messages")

        assert response.status_code == 401


class TestAuthMiddlewareCORS:
    """Test CORS preflight handling."""

    def test_options_request_allowed_without_auth(self, client):
        """OPTIONS requests (CORS preflight) don't require auth."""
        response = client.options("/mcp")

        # OPTIONS should not return 401
        assert response.status_code != 401


class TestAuthMiddlewareTokenAccess:
    """Test that tokens are accessible in handlers."""

    def test_token_accessible_via_get_access_token(self):
        """Authenticated requests have token accessible via get_access_token."""
        tokens = {"user-token": {"email": "user@example.com", "name": "Test User"}}
        app = create_test_app(MockAuthProvider(valid_tokens=tokens))
        client = TestClient(app, raise_server_exceptions=False)

        response = client.post("/mcp", headers={"Authorization": "Bearer user-token"})

        assert response.status_code == 200
        data = response.json()
        assert data["authenticated"] is True
        assert data["claims"]["email"] == "user@example.com"
        assert data["claims"]["name"] == "Test User"

    def test_unauthenticated_excluded_path_has_no_token(self, client):
        """Excluded paths without auth have no token set."""
        response = client.get("/health")

        assert response.status_code == 200


class TestAuthMiddlewareCustomPaths:
    """Test custom protected/excluded paths."""

    def test_custom_protected_paths(self):
        """Custom protected paths can be configured."""

        async def api_endpoint(request: Request) -> JSONResponse:
            return JSONResponse({"api": "data"})

        app = Starlette(routes=[Route("/api/data", api_endpoint, methods=["GET"])])
        app.add_middleware(
            AuthMiddleware,
            auth_provider=MockAuthProvider(),
            protected_paths=["/api"],
        )
        client = TestClient(app, raise_server_exceptions=False)

        # Without auth
        response = client.get("/api/data")
        assert response.status_code == 401

        # With auth
        response = client.get("/api/data", headers={"Authorization": "Bearer valid-token"})
        assert response.status_code == 200

    def test_custom_excluded_paths(self):
        """Custom excluded paths can be configured."""

        async def public_endpoint(request: Request) -> JSONResponse:
            return JSONResponse({"public": True})

        app = Starlette(
            routes=[
                Route("/mcp", public_endpoint, methods=["GET"]),
                Route("/public", public_endpoint, methods=["GET"]),
            ]
        )
        app.add_middleware(
            AuthMiddleware,
            auth_provider=MockAuthProvider(),
            exclude_paths=["/public"],
        )
        client = TestClient(app, raise_server_exceptions=False)

        # /mcp requires auth
        response = client.get("/mcp")
        assert response.status_code == 401

        # /public is excluded
        response = client.get("/public")
        assert response.status_code == 200


class TestAuthMiddlewarePathMatchingSecurity:
    """Test that path matching is secure against prefix attacks."""

    def test_similar_prefix_does_not_bypass_excluded_path(self):
        """Paths with similar prefixes should NOT bypass auth (e.g., /docs-secret).

        This tests that /docs-secret requires auth even though /docs is excluded.
        The fix ensures we match exact path or path + '/' prefix, not just startswith.
        """

        async def endpoint(request: Request) -> JSONResponse:
            return JSONResponse({"data": "secret"})

        app = Starlette(
            routes=[
                Route("/mcp", endpoint, methods=["GET"]),
                Route("/docs", endpoint, methods=["GET"]),
                Route("/docs-secret", endpoint, methods=["GET"]),
                Route("/docs/subpage", endpoint, methods=["GET"]),
            ]
        )
        app.add_middleware(
            AuthMiddleware,
            auth_provider=MockAuthProvider(),
            exclude_paths=["/docs"],
            protected_paths=["/mcp", "/docs-secret"],  # Explicitly protect /docs-secret
        )
        client = TestClient(app, raise_server_exceptions=False)

        # /docs is excluded - should work without auth
        response = client.get("/docs")
        assert response.status_code == 200

        # /docs/subpage is also excluded (subpath of /docs)
        response = client.get("/docs/subpage")
        assert response.status_code == 200

        # /docs-secret is NOT excluded and IS protected - should require auth
        response = client.get("/docs-secret")
        assert response.status_code == 401

        # /mcp requires auth
        response = client.get("/mcp")
        assert response.status_code == 401

    def test_subpath_of_excluded_path_is_also_excluded(self):
        """Subpaths of excluded paths should also be excluded (e.g., /docs/api)."""

        async def endpoint(request: Request) -> JSONResponse:
            return JSONResponse({"data": "ok"})

        app = Starlette(
            routes=[
                Route("/mcp", endpoint, methods=["GET"]),
                Route("/docs", endpoint, methods=["GET"]),
                Route("/docs/api", endpoint, methods=["GET"]),
            ]
        )
        app.add_middleware(
            AuthMiddleware,
            auth_provider=MockAuthProvider(),
            exclude_paths=["/docs"],
            protected_paths=["/mcp"],
        )
        client = TestClient(app, raise_server_exceptions=False)

        # /docs is excluded
        response = client.get("/docs")
        assert response.status_code == 200

        # /docs/api is also excluded (subpath)
        response = client.get("/docs/api")
        assert response.status_code == 200

        # /mcp still requires auth
        response = client.get("/mcp")
        assert response.status_code == 401

    def test_similar_prefix_does_not_match_protected_path(self):
        """Paths with similar prefixes should NOT be protected (e.g., /mcpx)."""

        async def endpoint(request: Request) -> JSONResponse:
            return JSONResponse({"data": "ok"})

        app = Starlette(
            routes=[
                Route("/mcp", endpoint, methods=["GET"]),
                Route("/mcp/messages", endpoint, methods=["POST"]),
                Route("/mcpx", endpoint, methods=["GET"]),
            ]
        )
        app.add_middleware(
            AuthMiddleware,
            auth_provider=MockAuthProvider(),
            protected_paths=["/mcp"],
        )
        client = TestClient(app, raise_server_exceptions=False)

        # /mcp requires auth
        response = client.get("/mcp")
        assert response.status_code == 401

        # /mcp/messages requires auth (subpath)
        response = client.post("/mcp/messages")
        assert response.status_code == 401

        # /mcpx does NOT require auth (different path, not a subpath)
        response = client.get("/mcpx")
        assert response.status_code == 200
