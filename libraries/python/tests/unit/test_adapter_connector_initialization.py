"""Unit tests for BaseAdapter and BaseConnector initialization handling."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from mcp.types import Tool

from mcp_use.agents.adapters.base import BaseAdapter
from mcp_use.client.connectors.base import BaseConnector


class DummyAdapter(BaseAdapter):
    """Concrete dummy adapter implementation for testing BaseAdapter logic."""

    def _convert_tool(self, tool: Tool, connector: BaseConnector):
        return tool

    def _convert_resource(self, resource, connector: BaseConnector):
        return resource

    def _convert_prompt(self, prompt, connector: BaseConnector):
        return prompt

    async def run(self, *args, **kwargs):
        pass

    async def run_stream(self, *args, **kwargs):
        pass

    def run_sync(self, *args, **kwargs):
        pass


class TestConnectorIsInitialized:
    """Tests for BaseConnector.is_initialized property."""

    def test_is_initialized_lifecycle(self):
        """Test is_initialized reflects connector lifecycle state."""
        connector = MagicMock(spec=BaseConnector)
        # By default uninitialized
        connector._initialized = False
        connector._tools = None

        # When property is invoked on actual BaseConnector logic:
        assert BaseConnector.is_initialized.fget(connector) is False

        # When initialized:
        connector._initialized = True
        assert BaseConnector.is_initialized.fget(connector) is True

        # When cleaned up / disconnected:
        connector._initialized = False
        assert BaseConnector.is_initialized.fget(connector) is False


class TestAdapterConnectorInitialization:
    """Tests for BaseAdapter initialization checking and error handling."""

    @pytest.mark.asyncio
    async def test_uninitialized_connector_does_not_crash_and_initializes(self):
        """Uninitialized connector accessing tools raises RuntimeError, but adapter must not crash."""
        adapter = DummyAdapter()

        connector = MagicMock(spec=BaseConnector)
        connector._initialized = False
        connector.is_initialized = False
        connector.initialize = AsyncMock()
        connector.list_tools = AsyncMock(return_value=[])

        def _raise_uninit(self):
            raise RuntimeError("MCP client is not initialized")

        # Accessing tools would raise RuntimeError
        type(connector).tools = property(_raise_uninit)

        # _check_connector_initialized must safely return False without raising RuntimeError
        assert adapter._check_connector_initialized(connector) is False

        # _ensure_connector_initialized must call initialize() once and succeed
        success = await adapter._ensure_connector_initialized(connector)
        assert success is True
        connector.initialize.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_initialized_connector_with_zero_tools_returns_true_no_reinit(self):
        """Initialized connector with 0 tools must return True and not trigger redundant initialize()."""
        adapter = DummyAdapter()

        connector = MagicMock(spec=BaseConnector)
        connector._initialized = True
        connector.is_initialized = True
        connector.initialize = AsyncMock()
        connector.list_tools = AsyncMock(return_value=[])
        connector.list_resources = AsyncMock(return_value=[])
        connector.list_prompts = AsyncMock(return_value=[])

        # _check_connector_initialized must be True despite having 0 tools
        assert adapter._check_connector_initialized(connector) is True

        # _ensure_connector_initialized must NOT re-call initialize()
        success = await adapter._ensure_connector_initialized(connector)
        assert success is True
        connector.initialize.assert_not_awaited()

        # Loading tools, resources, and prompts should never trigger initialize()
        await adapter.load_tools_for_connector(connector)
        await adapter.load_resources_for_connector(connector)
        await adapter.load_prompts_for_connector(connector)
        connector.initialize.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_legacy_mock_connector_without_is_initialized(self):
        """Legacy or third-party mock connector without is_initialized handles RuntimeError gracefully."""
        adapter = DummyAdapter()

        # Mock connector lacking is_initialized attribute
        legacy_connector = MagicMock(spec=["initialize", "tools", "list_tools", "public_identifier"])
        legacy_connector.initialize = AsyncMock()
        legacy_connector.list_tools = AsyncMock(return_value=[])
        legacy_connector.public_identifier = "legacy-mcp"

        def _raise_uninit(self):
            raise RuntimeError("MCP client is not initialized")

        # Simulating uninitialized tools access raising RuntimeError
        type(legacy_connector).tools = property(_raise_uninit)

        # Check must return False without crashing
        assert adapter._check_connector_initialized(legacy_connector) is False

        # Ensure must initialize
        success = await adapter._ensure_connector_initialized(legacy_connector)
        assert success is True
        legacy_connector.initialize.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_legacy_mock_connector_with_tools_list_returns_true(self):
        """Legacy mock connector with tools list returns True."""
        adapter = DummyAdapter()

        legacy_connector = MagicMock(spec=["initialize", "tools", "list_tools"])
        legacy_connector.tools = []

        assert adapter._check_connector_initialized(legacy_connector) is True
