"""
Unit tests for the get_all_capabilities() method.
"""

from unittest.mock import AsyncMock, Mock

import pytest
from mcp.types import Prompt, Resource, Tool

from mcp_use import MCPClient
from mcp_use.types.mcp import ServerCapability


class TestGetAllCapabilities:
    """Unit tests for the get_all_capabilities method."""

    @pytest.fixture
    def mock_session(self):
        """Create a mock session with predefined capabilities."""
        session = AsyncMock()

        # Mock tools
        mock_tools = [
            Tool(name="test_tool_1", description="Test tool 1", inputSchema={}),
            Tool(name="test_tool_2", description="Test tool 2", inputSchema={}),
        ]
        session.list_tools.return_value = mock_tools

        # Mock resources
        mock_resources = [
            Resource(name="test_resource", uri="test://resource/1", description="Test resource"),
        ]
        session.list_resources.return_value = mock_resources

        # Mock prompts
        mock_prompts = [
            Prompt(name="test_prompt", description="Test prompt"),
        ]
        session.list_prompts.return_value = mock_prompts

        return session

    @pytest.fixture
    def client_with_mock_session(self, mock_session):
        """Create a client with a mocked session."""
        client = MCPClient()
        client.sessions = {"test_server": mock_session}
        return client

    @pytest.mark.asyncio
    async def test_get_all_capabilities_success(self, client_with_mock_session):
        """Test successful retrieval of capabilities."""
        client = client_with_mock_session

        capabilities = await client.get_all_capabilities()

        # Check structure
        assert isinstance(capabilities, dict)
        assert "test_server" in capabilities

        server_cap = capabilities["test_server"]
        assert "tools" in server_cap
        assert "resources" in server_cap
        assert "prompts" in server_cap

        # Check content
        assert len(server_cap["tools"]) == 2
        assert len(server_cap["resources"]) == 1
        assert len(server_cap["prompts"]) == 1

        # Check types
        assert all(isinstance(tool, Tool) for tool in server_cap["tools"])
        assert all(isinstance(resource, Resource) for resource in server_cap["resources"])
        assert all(isinstance(prompt, Prompt) for prompt in server_cap["prompts"])

    @pytest.mark.asyncio
    async def test_get_all_capabilities_no_sessions(self):
        """Test error when no sessions are available."""
        client = MCPClient()

        with pytest.raises(ValueError, match="No sessions available"):
            await client.get_all_capabilities()

    @pytest.mark.asyncio
    async def test_get_all_capabilities_with_failing_session(self):
        """Test behavior when one session fails."""
        # Create a client with one working and one failing session
        working_session = AsyncMock()
        working_session.list_tools.return_value = [Tool(name="working_tool", description="Working", inputSchema={})]
        working_session.list_resources.return_value = []
        working_session.list_prompts.return_value = []

        failing_session = AsyncMock()
        failing_session.list_tools.side_effect = Exception("Connection failed")

        client = MCPClient()
        client.sessions = {"working_server": working_session, "failing_server": failing_session}

        capabilities = await client.get_all_capabilities()

        # Should only contain the working server
        assert len(capabilities) == 1
        assert "working_server" in capabilities
        assert "failing_server" not in capabilities

        # Working server should have correct data
        assert len(capabilities["working_server"]["tools"]) == 1
        assert capabilities["working_server"]["tools"][0].name == "working_tool"

    @pytest.mark.asyncio
    async def test_get_all_capabilities_all_sessions_fail(self):
        """Test error when all sessions fail."""
        failing_session = AsyncMock()
        failing_session.list_tools.side_effect = Exception("Connection failed")

        client = MCPClient()
        client.sessions = {"failing_server": failing_session}

        with pytest.raises(RuntimeError, match="Failed to get capabilities from any server"):
            await client.get_all_capabilities()

    @pytest.mark.asyncio
    async def test_get_all_capabilities_return_type_annotation(self, client_with_mock_session):
        """Test that return type matches ServerCapability annotation."""
        client = client_with_mock_session

        # This should not raise type errors if properly annotated
        capabilities: dict[str, ServerCapability] = await client.get_all_capabilities()

        # Access fields as per ServerCapability TypedDict
        server_cap = capabilities["test_server"]
        tools = server_cap["tools"]
        resources = server_cap["resources"]
        prompts = server_cap["prompts"]

        # Verify we can access the expected fields
        assert isinstance(tools, list)
        assert isinstance(resources, list)
        assert isinstance(prompts, list)
