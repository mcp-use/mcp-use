"""Unit tests for OAuth.initialize() token handling."""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from authlib.oauth2 import OAuth2Error

from mcp_use.client.auth.oauth import (
    FileTokenStorage,
    OAuth,
    OAuthClientProvider,
    ServerOAuthMetadata,
)

SERVER_URL = "https://mcp.example.com/mcp"

METADATA = ServerOAuthMetadata(
    issuer="https://auth.example.com",
    authorization_endpoint="https://auth.example.com/authorize",
    token_endpoint="https://auth.example.com/token",
    code_challenge_methods_supported=["S256"],
)


async def store_tokens(storage: FileTokenStorage, **overrides) -> None:
    """Store a token file for SERVER_URL, expired unless overridden."""
    tokens = {
        "access_token": "expired-token",
        "token_type": "Bearer",
        "expires_at": 1_000_000_000.0,  # long past
        "refresh_token": "stored-refresh-token",
    }
    tokens.update(overrides)
    await storage.save_tokens(SERVER_URL, tokens)


def oauth_client_returning(refresh_token_result) -> MagicMock:
    """Build a stand-in for AsyncOAuth2Client whose refresh_token() returns the given result."""
    client = MagicMock()
    client.refresh_token = AsyncMock(return_value=refresh_token_result)
    return client


def oauth_client_raising(error: Exception) -> MagicMock:
    """Build a stand-in for AsyncOAuth2Client whose refresh_token() raises the given error."""
    client = MagicMock()
    client.refresh_token = AsyncMock(side_effect=error)
    return client


class TestOAuthInitializeExpiredToken:
    """Tests for OAuth.initialize() with an expired stored token."""

    @pytest.mark.asyncio
    async def test_refreshes_expired_token_with_stored_refresh_token(self, tmp_path):
        """An expired token with a refresh token is refreshed instead of dropped."""
        storage = FileTokenStorage(base_dir=tmp_path)
        await store_tokens(storage)
        oauth = OAuth(
            SERVER_URL,
            token_storage=storage,
            client_id="client-id",
            oauth_provider=OAuthClientProvider(id="test", display_name="Test", metadata=METADATA),
        )

        with patch("mcp_use.client.auth.oauth.AsyncOAuth2Client") as mock_client_class:
            mock_client_class.return_value = oauth_client_returning(
                {
                    "access_token": "refreshed-token",
                    "token_type": "Bearer",
                    "expires_in": 3600,
                    "refresh_token": "rotated-refresh-token",
                }
            )
            async with httpx.AsyncClient() as client:
                auth = await oauth.initialize(client)

        assert auth is not None
        assert auth.token.get_secret_value() == "refreshed-token"
        refresh_call = mock_client_class.return_value.refresh_token.await_args
        assert refresh_call.args[0] == "https://auth.example.com/token"
        assert refresh_call.kwargs["refresh_token"] == "stored-refresh-token"

        stored = await storage.load_tokens(SERVER_URL)
        assert stored.access_token == "refreshed-token"
        assert stored.refresh_token == "rotated-refresh-token"

    @pytest.mark.asyncio
    async def test_refreshes_expired_token_when_metadata_is_discovered(self, tmp_path):
        """Refresh also happens when no provider metadata was configured up front."""
        storage = FileTokenStorage(base_dir=tmp_path)
        await store_tokens(storage)
        oauth = OAuth(SERVER_URL, token_storage=storage, client_id="client-id")

        async def discover(_client):
            oauth._metadata = METADATA

        with patch.object(OAuth, "_discover_metadata", side_effect=discover) as mock_discovery:
            with patch("mcp_use.client.auth.oauth.AsyncOAuth2Client") as mock_client_class:
                mock_client_class.return_value = oauth_client_returning(
                    {"access_token": "refreshed-token", "token_type": "Bearer", "expires_in": 3600}
                )
                async with httpx.AsyncClient() as client:
                    auth = await oauth.initialize(client)

        mock_discovery.assert_called_once()
        assert auth is not None
        assert auth.token.get_secret_value() == "refreshed-token"

    @pytest.mark.asyncio
    async def test_expired_token_without_refresh_token_returns_none(self, tmp_path):
        """Without a refresh token there is nothing to refresh, so the interactive flow is next."""
        storage = FileTokenStorage(base_dir=tmp_path)
        await store_tokens(storage, refresh_token=None)
        oauth = OAuth(
            SERVER_URL,
            token_storage=storage,
            client_id="client-id",
            oauth_provider=OAuthClientProvider(id="test", display_name="Test", metadata=METADATA),
        )

        with patch("mcp_use.client.auth.oauth.AsyncOAuth2Client") as mock_client_class:
            async with httpx.AsyncClient() as client:
                auth = await oauth.initialize(client)

        assert auth is None
        mock_client_class.assert_not_called()

    @pytest.mark.asyncio
    async def test_failed_refresh_returns_none(self, tmp_path):
        """A rejected refresh falls back to the interactive flow instead of raising."""
        storage = FileTokenStorage(base_dir=tmp_path)
        await store_tokens(storage)
        oauth = OAuth(
            SERVER_URL,
            token_storage=storage,
            client_id="client-id",
            oauth_provider=OAuthClientProvider(id="test", display_name="Test", metadata=METADATA),
        )

        with patch("mcp_use.client.auth.oauth.AsyncOAuth2Client") as mock_client_class:
            mock_client_class.return_value = oauth_client_raising(OAuth2Error(error="invalid_grant"))
            async with httpx.AsyncClient() as client:
                auth = await oauth.initialize(client)

        assert auth is None
        assert mock_client_class.return_value.refresh_token.await_count == 1

    @pytest.mark.asyncio
    async def test_valid_token_is_returned_without_refreshing(self, tmp_path):
        """A still valid token short-circuits initialize() as before."""
        storage = FileTokenStorage(base_dir=tmp_path)
        await store_tokens(storage, access_token="valid-token", expires_at=4_000_000_000.0)
        oauth = OAuth(
            SERVER_URL,
            token_storage=storage,
            client_id="client-id",
            oauth_provider=OAuthClientProvider(id="test", display_name="Test", metadata=METADATA),
        )

        with patch("mcp_use.client.auth.oauth.AsyncOAuth2Client") as mock_client_class:
            async with httpx.AsyncClient() as client:
                auth = await oauth.initialize(client)

        assert auth is not None
        assert auth.token.get_secret_value() == "valid-token"
        mock_client_class.assert_not_called()
