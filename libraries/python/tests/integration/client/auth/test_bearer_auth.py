"""Integration tests for bearer token authentication.

Tests the full flow of MCPClient connecting to an MCPServer with bearer auth.
"""

import asyncio
import subprocess
import sys
from pathlib import Path

import pytest

from mcp_use import MCPClient


@pytest.fixture
async def bearer_auth_server():
    """Start the bearer auth test server."""
    server_path = Path(__file__).parent.parent.parent / "servers_for_testing" / "bearer_auth_server.py"

    process = subprocess.Popen(
        [sys.executable, str(server_path), "--transport", "streamable-http", "--port", "8082"],
        cwd=str(server_path.parent),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    # Give server time to start
    await asyncio.sleep(3)
    server_url = "http://127.0.0.1:8082"

    yield server_url

    # Cleanup
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


class TestBearerAuthConnection:
    """Test MCPClient connection with bearer auth."""

    @pytest.mark.asyncio
    async def test_connection_with_valid_token(self, bearer_auth_server):
        """Client can connect and call tools with valid bearer token."""
        server_url = bearer_auth_server
        config = {
            "mcpServers": {
                "auth_server": {
                    "url": f"{server_url}/mcp",
                    "headers": {"Authorization": "Bearer test-token-alice"},
                }
            }
        }

        client = MCPClient(config=config)
        try:
            await client.create_all_sessions()
            session = client.get_session("auth_server")

            assert session is not None

            # List tools should work
            tools = await session.list_tools()
            assert tools is not None
            tool_names = [t.name for t in tools]
            assert "whoami" in tool_names
            assert "add" in tool_names

            # Call whoami to verify auth info is accessible
            result = await session.call_tool("whoami", {})
            assert result is not None
            assert result.content[0].text is not None

            # Parse the result (it's a dict serialized as string)
            import json

            data = json.loads(result.content[0].text)
            assert data["authenticated"] is True
            assert data["email"] == "alice@example.com"

        finally:
            await client.close_all_sessions()

    @pytest.mark.asyncio
    async def test_connection_with_invalid_token_fails(self, bearer_auth_server):
        """Client connection fails with invalid bearer token."""
        server_url = bearer_auth_server
        config = {
            "mcpServers": {
                "auth_server": {
                    "url": f"{server_url}/mcp",
                    "headers": {"Authorization": "Bearer invalid-token"},
                }
            }
        }

        client = MCPClient(config=config)
        try:
            # Connection should fail with 401
            with pytest.raises(Exception):
                await client.create_all_sessions()
        finally:
            await client.close_all_sessions()

    @pytest.mark.asyncio
    async def test_connection_without_token_fails(self, bearer_auth_server):
        """Client connection fails without bearer token."""
        server_url = bearer_auth_server
        config = {
            "mcpServers": {
                "auth_server": {
                    "url": f"{server_url}/mcp",
                    # No Authorization header
                }
            }
        }

        client = MCPClient(config=config)
        try:
            # Connection should fail with 401
            with pytest.raises(Exception):
                await client.create_all_sessions()
        finally:
            await client.close_all_sessions()

    @pytest.mark.asyncio
    async def test_tool_can_access_user_claims(self, bearer_auth_server):
        """Tools can access authenticated user's claims."""
        server_url = bearer_auth_server
        config = {
            "mcpServers": {
                "auth_server": {
                    "url": f"{server_url}/mcp",
                    "headers": {"Authorization": "Bearer test-token-bob"},
                }
            }
        }

        client = MCPClient(config=config)
        try:
            await client.create_all_sessions()
            session = client.get_session("auth_server")

            result = await session.call_tool("whoami", {})

            import json

            data = json.loads(result.content[0].text)
            assert data["authenticated"] is True
            assert data["email"] == "bob@example.com"
            assert data["name"] == "Bob"

        finally:
            await client.close_all_sessions()

    @pytest.mark.asyncio
    async def test_admin_token_has_scopes(self, bearer_auth_server):
        """Admin token includes scopes."""
        server_url = bearer_auth_server
        config = {
            "mcpServers": {
                "auth_server": {
                    "url": f"{server_url}/mcp",
                    "headers": {"Authorization": "Bearer admin-token"},
                }
            }
        }

        client = MCPClient(config=config)
        try:
            await client.create_all_sessions()
            session = client.get_session("auth_server")

            result = await session.call_tool("whoami", {})

            import json

            data = json.loads(result.content[0].text)
            assert data["authenticated"] is True
            assert "admin" in data["scopes"]
            assert "read" in data["scopes"]
            assert "write" in data["scopes"]

        finally:
            await client.close_all_sessions()

    @pytest.mark.asyncio
    async def test_regular_tool_works_with_auth(self, bearer_auth_server):
        """Regular tools work normally when authenticated."""
        server_url = bearer_auth_server
        config = {
            "mcpServers": {
                "auth_server": {
                    "url": f"{server_url}/mcp",
                    "headers": {"Authorization": "Bearer test-token-alice"},
                }
            }
        }

        client = MCPClient(config=config)
        try:
            await client.create_all_sessions()
            session = client.get_session("auth_server")

            # Call add tool
            result = await session.call_tool("add", {"a": 10, "b": 32})
            assert result.content[0].text == "42"

        finally:
            await client.close_all_sessions()
