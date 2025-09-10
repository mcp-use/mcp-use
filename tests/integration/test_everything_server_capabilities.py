"""
Integration tests for server capabilities and React adapter conversion using the everything server.
"""

from collections.abc import AsyncGenerator

import pytest
from mcp.types import Prompt, Resource, Tool

from mcp_use import MCPClient
from mcp_use.adapters.react_adapter import ReactAdapter
from mcp_use.types.mcp import ServerCapability

# Configuration for the everything server
EVERYTHING_SERVER_CONFIG = {
    "mcpServers": {"everything": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-everything"]}}
}

# Expected capabilities from the everything server (based on known server behavior)
EXPECTED_TOOLS = [
    "echo",
    "add",
    "printEnv",
    "longRunningOperation",
    "sampleLLM",
    "getTinyImage",
    "annotatedMessage",
    "getResourceReference",
]
EXPECTED_RESOURCE_COUNT = 10  # Resource 1 through Resource 10
EXPECTED_PROMPTS = ["simple_prompt", "complex_prompt", "resource_prompt"]


class TestEverythingServerCapabilities:
    """Test suite for everything server capabilities retrieval."""

    @pytest.fixture
    async def client(self):
        """Create and initialize an MCPClient with the everything server."""
        client = MCPClient(config=EVERYTHING_SERVER_CONFIG)
        await client.create_all_sessions()
        yield client
        await client.close_all_sessions()

    @pytest.mark.asyncio
    async def test_get_all_capabilities_structure(self, client: MCPClient):
        """Test that get_all_capabilities returns the correct structure."""
        capabilities = await client.get_all_capabilities()

        # Check basic structure
        assert isinstance(capabilities, dict)
        assert "everything" in capabilities

        server_capability = capabilities["everything"]
        assert isinstance(server_capability, dict)

        # Check all required keys are present
        assert "tools" in server_capability
        assert "resources" in server_capability
        assert "prompts" in server_capability

        # Check types
        assert isinstance(server_capability["tools"], list)
        assert isinstance(server_capability["resources"], list)
        assert isinstance(server_capability["prompts"], list)

    @pytest.mark.asyncio
    async def test_tools_capabilities(self, client: MCPClient):
        """Test that all expected tools are returned with correct types."""
        capabilities = await client.get_all_capabilities()
        tools = capabilities["everything"]["tools"]

        # Check we have the expected number of tools
        assert len(tools) == len(EXPECTED_TOOLS)

        # Check all tools are Tool objects
        for tool in tools:
            assert isinstance(tool, Tool)
            assert hasattr(tool, "name")
            assert hasattr(tool, "description")

        # Check all expected tools are present
        tool_names = [tool.name for tool in tools]
        for expected_tool in EXPECTED_TOOLS:
            assert expected_tool in tool_names, f"Expected tool '{expected_tool}' not found in {tool_names}"

    @pytest.mark.asyncio
    async def test_resources_capabilities(self, client: MCPClient):
        """Test that all expected resources are returned with correct types."""
        capabilities = await client.get_all_capabilities()
        resources = capabilities["everything"]["resources"]

        # Check we have the expected number of resources
        assert len(resources) == EXPECTED_RESOURCE_COUNT

        # Check all resources are Resource objects
        for resource in resources:
            assert isinstance(resource, Resource)
            assert hasattr(resource, "name")
            assert hasattr(resource, "uri")

        # Check resource names and URIs follow expected pattern
        for i, resource in enumerate(resources, 1):
            assert resource.name == f"Resource {i}"
            assert str(resource.uri) == f"test://static/resource/{i}"

    @pytest.mark.asyncio
    async def test_prompts_capabilities(self, client: MCPClient):
        """Test that all expected prompts are returned with correct types."""
        capabilities = await client.get_all_capabilities()
        prompts = capabilities["everything"]["prompts"]

        # Check we have the expected number of prompts
        assert len(prompts) == len(EXPECTED_PROMPTS)

        # Check all prompts are Prompt objects
        for prompt in prompts:
            assert isinstance(prompt, Prompt)
            assert hasattr(prompt, "name")
            assert hasattr(prompt, "description")

        # Check all expected prompts are present
        prompt_names = [prompt.name for prompt in prompts]
        for expected_prompt in EXPECTED_PROMPTS:
            assert expected_prompt in prompt_names, f"Expected prompt '{expected_prompt}' not found in {prompt_names}"

    @pytest.mark.asyncio
    async def test_server_capability_typing(self, client: MCPClient):
        """Test that the return type matches ServerCapability TypedDict."""
        capabilities: dict[str, ServerCapability] = await client.get_all_capabilities()

        # This should not raise any type errors if properly typed
        server_cap = capabilities["everything"]

        # Access fields as per ServerCapability definition
        tools = server_cap["tools"]
        resources = server_cap["resources"]
        prompts = server_cap["prompts"]

        # Verify types
        assert all(isinstance(tool, Tool) for tool in tools)
        assert all(isinstance(resource, Resource) for resource in resources)
        assert all(isinstance(prompt, Prompt) for prompt in prompts)


class TestReactAdapterCapabilities:
    """Test suite for React adapter capability conversion."""

    @pytest.fixture
    async def client_and_adapter(self) -> AsyncGenerator[tuple[MCPClient, ReactAdapter], None]:
        """Create client and React adapter for testing."""
        client = MCPClient(config=EVERYTHING_SERVER_CONFIG)
        await client.create_all_sessions()

        # Create adapter with all capabilities enabled
        adapter = ReactAdapter(include_resources=True, include_prompts=True)

        yield client, adapter
        await client.close_all_sessions()

    @pytest.mark.asyncio
    async def test_tools_conversion(self, client_and_adapter: tuple[MCPClient, ReactAdapter]):
        """Test that tools are correctly converted to React adapter format."""
        client, adapter = client_and_adapter
        session = client.get_session("everything")

        # Load tools through adapter
        converted_tools = await adapter.load_tools_for_connector(session.connector)

        # Filter for actual tools (not resources/prompts)
        tool_items = [item for item in converted_tools if item["type"] == "tool"]

        # Check we have all expected tools
        assert len(tool_items) == len(EXPECTED_TOOLS)

        # Check tool structure
        for tool_item in tool_items:
            assert "name" in tool_item
            assert "session" in tool_item
            assert "schema" in tool_item
            assert "description" in tool_item
            assert tool_item["type"] == "tool"

            # Verify tool name is in expected list
            assert tool_item["name"] in EXPECTED_TOOLS

    @pytest.mark.asyncio
    async def test_resources_conversion(self, client_and_adapter: tuple[MCPClient, ReactAdapter]):
        """Test that resources are correctly converted to React adapter format."""
        client, adapter = client_and_adapter
        session = client.get_session("everything")

        # Load tools through adapter (includes resources)
        converted_tools = await adapter.load_tools_for_connector(session.connector)

        # Filter for resources
        resource_items = [item for item in converted_tools if item["type"] == "resource"]

        # Check we have all expected resources
        assert len(resource_items) == EXPECTED_RESOURCE_COUNT

        # Check resource structure
        for resource_item in resource_items:
            assert "name" in resource_item
            assert "session" in resource_item
            assert "schema" in resource_item
            assert "description" in resource_item
            assert "resource_uri" in resource_item
            assert resource_item["type"] == "resource"

            # Check naming convention
            assert resource_item["name"].startswith("read_resource_Resource")
            assert str(resource_item["resource_uri"]).startswith("test://static/resource/")

    @pytest.mark.asyncio
    async def test_prompts_conversion(self, client_and_adapter: tuple[MCPClient, ReactAdapter]):
        """Test that prompts are correctly converted to React adapter format."""
        client, adapter = client_and_adapter
        session = client.get_session("everything")

        # Load tools through adapter (includes prompts)
        converted_tools = await adapter.load_tools_for_connector(session.connector)

        # Filter for prompts
        prompt_items = [item for item in converted_tools if item["type"] == "prompt"]

        # Check we have all expected prompts
        assert len(prompt_items) == len(EXPECTED_PROMPTS)

        # Check prompt structure
        for prompt_item in prompt_items:
            assert "name" in prompt_item
            assert "session" in prompt_item
            assert "schema" in prompt_item
            assert "description" in prompt_item
            assert "prompt_name" in prompt_item
            assert prompt_item["type"] == "prompt"

            # Check naming convention
            assert prompt_item["name"].startswith("get_prompt_")

            # Extract prompt name and verify it's expected
            prompt_name = prompt_item["prompt_name"]
            assert prompt_name in EXPECTED_PROMPTS

    @pytest.mark.asyncio
    async def test_total_converted_items(self, client_and_adapter: tuple[MCPClient, ReactAdapter]):
        """Test that the total number of converted items matches expectations."""
        client, adapter = client_and_adapter
        session = client.get_session("everything")

        # Load all tools through adapter
        converted_tools = await adapter.load_tools_for_connector(session.connector)

        # Count by type
        tools_count = len([item for item in converted_tools if item["type"] == "tool"])
        resources_count = len([item for item in converted_tools if item["type"] == "resource"])
        prompts_count = len([item for item in converted_tools if item["type"] == "prompt"])

        # Verify counts
        assert tools_count == len(EXPECTED_TOOLS)
        assert resources_count == EXPECTED_RESOURCE_COUNT
        assert prompts_count == len(EXPECTED_PROMPTS)

        # Total should match sum
        expected_total = len(EXPECTED_TOOLS) + EXPECTED_RESOURCE_COUNT + len(EXPECTED_PROMPTS)
        assert len(converted_tools) == expected_total

    @pytest.mark.asyncio
    async def test_adapter_without_resources_and_prompts(self, client_and_adapter: tuple[MCPClient, ReactAdapter]):
        """Test adapter behavior when resources and prompts are disabled."""
        client, _ = client_and_adapter

        # Create adapter with resources and prompts disabled
        adapter = ReactAdapter(include_resources=False, include_prompts=False)

        session = client.get_session("everything")
        converted_tools = await adapter.load_tools_for_connector(session.connector)

        # Should only have tools
        assert len(converted_tools) == len(EXPECTED_TOOLS)
        assert all(item["type"] == "tool" for item in converted_tools)
