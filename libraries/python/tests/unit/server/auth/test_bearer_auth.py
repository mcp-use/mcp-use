"""Unit tests for bearer token authentication."""

import pytest

from mcp_use.server.auth import (
    AccessToken,
    AuthenticationError,
    BearerAuthProvider,
    get_access_token,
    require_auth,
)
from mcp_use.server.auth.dependencies import set_access_token

# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture(autouse=True)
def reset_access_token():
    """Reset access token before and after each test."""
    set_access_token(None)
    yield
    set_access_token(None)


@pytest.fixture
def sample_token():
    """A sample access token for testing."""
    return AccessToken(token="test", claims={"email": "test@example.com"})


# ============================================================================
# Tests
# ============================================================================


class TestAccessToken:
    """Tests for AccessToken model."""

    def test_create_minimal_token(self):
        """AccessToken can be created with just token field."""
        token = AccessToken(token="abc123")
        assert token.token == "abc123"
        assert token.claims == {}
        assert token.scopes == []

    def test_create_token_with_claims(self):
        """AccessToken stores claims correctly."""
        token = AccessToken(
            token="abc123",
            claims={"email": "alice@example.com", "sub": "user-1"},
        )
        assert token.token == "abc123"
        assert token.claims["email"] == "alice@example.com"
        assert token.claims["sub"] == "user-1"

    def test_create_token_with_scopes(self):
        """AccessToken stores scopes correctly."""
        token = AccessToken(
            token="abc123",
            claims={"email": "alice@example.com"},
            scopes=["read", "write", "admin"],
        )
        assert token.scopes == ["read", "write", "admin"]
        assert "admin" in token.scopes

    def test_token_is_pydantic_model(self):
        """AccessToken can be serialized to dict."""
        token = AccessToken(
            token="abc123",
            claims={"email": "alice@example.com"},
            scopes=["read"],
        )
        data = token.model_dump()
        assert data["token"] == "abc123"
        assert data["claims"]["email"] == "alice@example.com"
        assert data["scopes"] == ["read"]


class TestBearerAuthProvider:
    """Tests for BearerAuthProvider base class."""

    def test_is_abstract(self):
        """BearerAuthProvider cannot be instantiated directly."""
        with pytest.raises(TypeError, match="abstract"):
            BearerAuthProvider()

    @pytest.mark.asyncio
    async def test_subclass_can_verify_token(self):
        """Subclass can implement verify_token."""

        class SimpleAuthProvider(BearerAuthProvider):
            async def verify_token(self, token: str) -> AccessToken | None:
                if token == "valid":
                    return AccessToken(token=token, claims={"user": "test"})
                return None

        provider = SimpleAuthProvider()

        # Valid token
        result = await provider.verify_token("valid")
        assert result is not None
        assert result.token == "valid"
        assert result.claims["user"] == "test"

        # Invalid token
        result = await provider.verify_token("invalid")
        assert result is None

    @pytest.mark.asyncio
    async def test_verify_token_can_return_scopes(self):
        """verify_token can return token with scopes."""

        class ScopedAuthProvider(BearerAuthProvider):
            async def verify_token(self, token: str) -> AccessToken | None:
                if token.startswith("admin-"):
                    return AccessToken(
                        token=token,
                        claims={"role": "admin"},
                        scopes=["read", "write", "admin"],
                    )
                elif token.startswith("user-"):
                    return AccessToken(
                        token=token,
                        claims={"role": "user"},
                        scopes=["read"],
                    )
                return None

        provider = ScopedAuthProvider()

        admin_token = await provider.verify_token("admin-123")
        assert admin_token is not None
        assert "admin" in admin_token.scopes

        user_token = await provider.verify_token("user-456")
        assert user_token is not None
        assert "admin" not in user_token.scopes
        assert "read" in user_token.scopes


class TestContextDependencies:
    """Tests for get_access_token and require_auth."""

    def test_get_access_token_returns_none_when_not_set(self):
        """get_access_token returns None when no token is set."""
        assert get_access_token() is None

    def test_get_access_token_returns_token_when_set(self, sample_token):
        """get_access_token returns the token when set."""
        set_access_token(sample_token)

        result = get_access_token()
        assert result is not None
        assert result.token == "test"
        assert result.claims["email"] == "test@example.com"

    def test_require_auth_raises_when_not_authenticated(self):
        """require_auth raises AuthenticationError when not authenticated."""
        with pytest.raises(AuthenticationError, match="Authentication required"):
            require_auth()

    def test_require_auth_returns_token_when_authenticated(self, sample_token):
        """require_auth returns token when authenticated."""
        set_access_token(sample_token)

        result = require_auth()
        assert result.token == "test"

    def test_set_access_token_can_clear_token(self, sample_token):
        """set_access_token(None) clears the token."""
        set_access_token(sample_token)
        assert get_access_token() is not None

        set_access_token(None)
        assert get_access_token() is None
