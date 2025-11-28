import token
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import Auth, Request

from mcp_use import MCPClient, set_debug
from mcp_use.client.auth.bearer import BearerAuth

set_debug(2)


@pytest.mark.asyncio
async def test_bearer_auth(auth_server):
    """Test Bearer token authentication."""
    config = {"mcpServers": {"AuthServer": {"url": f"{auth_server}/mcp", "auth": "valid_token"}}}
    client = MCPClient(config)
    try:
        await client.create_all_sessions()
        session = client.get_session("AuthServer")

        assert session.connector._auth is not None

        # Test that we can call protected tools
        result = await session.call_tool(name="protected_tool", arguments={})
        assert result.content[0].text == "Authenticated access granted!"

        # Test that we can call regular tools
        result = await session.call_tool(name="add", arguments={"a": 5, "b": 3})
        assert result.content[0].text == "8"
    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
@patch("secrets.token_urlsafe")
@patch("webbrowser.open")
@patch("mcp_use.client.auth.oauth.OAuthCallbackServer")
async def test_oauth_provider(mock_callback_server_class, mock_webbrowser_open, mock_token_urlsafe, auth_server):
    """Test OAuth with pre-configured provider metadata."""
    await clean_token()

    # Mock the callback server
    mock_callback_server = AsyncMock()
    mock_callback_server.start.return_value = "http://127.0.0.1:8080/callback"
    mock_callback_server.wait_for_code.return_value = MagicMock(
        code="test_auth_code_12345", state="test_state_67890", error=None, error_description=None
    )
    mock_callback_server_class.return_value = mock_callback_server
    mock_webbrowser_open.return_value = None

    # Avoid CSRF error during testing
    mock_token_urlsafe.return_value = "test_state_67890"

    config = {
        "mcpServers": {
            "AuthServer": {
                "url": f"{auth_server}/mcp",
                "auth": {
                    "oauth_provider": {
                        "id": "auth_server",
                        "display_name": "AuthServer",
                        "metadata": {
                            "issuer": "http://127.0.0.1:8081",
                            "authorization_endpoint": "http://127.0.0.1:8081/oauth/authorize",
                            "token_endpoint": "http://127.0.0.1:8081/oauth/token",
                            "registration_endpoint": "http://127.0.0.1:8081/oauth/register",
                        },
                    }
                },
            }
        }
    }
    client = MCPClient(config)
    try:
        await client.create_all_sessions()
        session = client.get_session("AuthServer")

        # Verify OAuth metadata was discovered
        assert session.connector._oauth is not None, "OAuth should be initialized"
        assert session.connector._oauth._metadata is not None, "OAuth metadata should be discovered"
        assert str(session.connector._oauth._metadata.issuer) == "http://127.0.0.1:8081/"
        assert str(session.connector._oauth._metadata.authorization_endpoint) == "http://127.0.0.1:8081/oauth/authorize"
        assert str(session.connector._oauth._metadata.registration_endpoint) == "http://127.0.0.1:8081/oauth/register"
        assert str(session.connector._oauth._metadata.token_endpoint) == "http://127.0.0.1:8081/oauth/token"

        mock_webbrowser_open.assert_called_once()
        mock_callback_server_class.assert_called_once()
        mock_callback_server.start.assert_called_once()
        mock_callback_server.wait_for_code.assert_called_once()

        assert session.connector._auth is not None

        # Test that we can call protected tools
        result = await session.call_tool(name="protected_tool", arguments={})
        assert result.content[0].text == "Authenticated access granted!"

        # Test that we can call regular tools
        result = await session.call_tool(name="add", arguments={"a": 5, "b": 3})
        assert result.content[0].text == "8"
    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_custom_client(auth_server):
    "Test that custom httpx.Auth objects works in auth field."

    custom_auth = BearerAuth(token="valid_token")
    config = {"mcpServers": {"AuthServer": {"url": f"{auth_server}/mcp", "auth": custom_auth}}}

    client = MCPClient(config)
    try:
        await client.create_all_sessions()
        session = client.get_session("AuthServer")

        # Verify the custom BearerAuth is being used
        assert session.connector._auth == custom_auth

        # Test that we can call protected tools
        result = await session.call_tool(name="protected_tool", arguments={})
        assert result.content[0].text == "Authenticated access granted!"

        # Test that we can call regular tools
        result = await session.call_tool(name="add", arguments={"a": 5, "b": 3})
        assert result.content[0].text == "8"

    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
@patch("secrets.token_urlsafe")
@patch("webbrowser.open")
@patch("mcp_use.client.auth.oauth.OAuthCallbackServer")
async def test_oauth_complete_flow(mock_callback_server_class, mock_webbrowser_open, mock_token_urlsafe, auth_server):
    """Test OAuth complete flow, with metadata discovery, DCR and auth token."""
    await clean_token()

    # Mock the callback server
    mock_callback_server = AsyncMock()
    mock_callback_server.start.return_value = "http://127.0.0.1:8080/callback"
    mock_callback_server.wait_for_code.return_value = MagicMock(
        code="test_auth_code_12345", state="test_state_67890", error=None, error_description=None
    )
    mock_callback_server_class.return_value = mock_callback_server
    mock_webbrowser_open.return_value = None

    # Avoid CSRF error during testing
    mock_token_urlsafe.return_value = "test_state_67890"

    config = {
        "mcpServers": {
            "AuthServer": {
                "url": f"{auth_server}/mcp",
            }
        }
    }
    client = MCPClient(config)
    try:
        await client.create_all_sessions()
        session = client.get_session("AuthServer")

        # Verify OAuth metadata was discovered
        assert session.connector._oauth is not None, "OAuth should be initialized"
        assert session.connector._oauth._metadata is not None, "OAuth metadata should be discovered"
        assert str(session.connector._oauth._metadata.issuer) == "http://127.0.0.1:8081/"
        assert str(session.connector._oauth._metadata.authorization_endpoint) == "http://127.0.0.1:8081/oauth/authorize"
        assert str(session.connector._oauth._metadata.registration_endpoint) == "http://127.0.0.1:8081/oauth/register"
        assert str(session.connector._oauth._metadata.token_endpoint) == "http://127.0.0.1:8081/oauth/token"

        mock_webbrowser_open.assert_called_once()
        mock_callback_server_class.assert_called_once()
        mock_callback_server.start.assert_called_once()
        mock_callback_server.wait_for_code.assert_called_once()

        assert session.connector._auth is not None

        # Test that we can call protected tools
        result = await session.call_tool(name="protected_tool", arguments={})
        assert result.content[0].text == "Authenticated access granted!"

        # Test that we can call regular tools
        result = await session.call_tool(name="add", arguments={"a": 5, "b": 3})
        assert result.content[0].text == "8"
    finally:
        await client.close_all_sessions()


async def clean_token():
    # Clear any existing tokens for this server before the test
    token_dir = Path.home() / ".mcp_use" / "tokens"
    if token_dir.exists():
        for token_file in token_dir.glob("*127.0.0.1:8081__mcp.json"):
            # Clear the file
            token_file.unlink()
        registrations_dir = token_dir / "registrations"
        for registration_file in registrations_dir.glob("*127.0.0.1:8081__mcp_registration.json"):
            registration_file.unlink()
