#!/usr/bin/env python3
"""
Test for issue #138 - tuple unpacking error in search_tools when using server manager.

This test specifically covers the scenario where ToolSearchEngine.search_tools()
would return inconsistent types (string vs list of tuples), causing a ValueError
when SearchToolsTool tried to format the results.
"""

from unittest.mock import AsyncMock, Mock, patch

import pytest
from langchain_core.tools import BaseTool
from pydantic import BaseModel

from mcp_use.managers.tools.search_tools import SearchToolsTool, ToolSearchEngine, ToolSearchInput


class MockTool(BaseTool):
    """Mock tool for testing"""

    name: str = "mock_tool"
    description: str = "A mock tool for testing"

    def _run(self, input_str: str) -> str:
        return f"Mock result: {input_str}"


class TestSearchToolsIssue138:
    """Test suite for issue #138 - search tools tuple unpacking error"""

    def setup_method(self):
        """Set up test fixtures"""
        self.mock_server_manager = Mock()
        self.mock_server_manager.active_server = "test_server"

    @patch("mcp_use.managers.tools.search_tools.logger")
    async def test_tool_search_engine_consistent_return_type_with_results(self, mock_logger):
        """Test that ToolSearchEngine.search_tools() returns string when results found"""
        search_engine = ToolSearchEngine()
        search_engine.is_indexed = True

        # Mock the search method to return results
        mock_tool = MockTool()
        search_results = [(mock_tool, "test_server", 0.95)]
        search_engine.search = Mock(return_value=search_results)

        # Call search_tools - should return formatted string, not raw results
        result = await search_engine.search_tools("test query", top_k=5)

        # Verify return type is string (the bug was returning list here)
        assert isinstance(result, str), f"Expected str, got {type(result)}"
        assert "Search results" in result
        assert "mock_tool" in result
        assert "test_server" in result
        assert "95.0%" in result

    async def test_tool_search_engine_consistent_return_type_no_results(self):
        """Test that ToolSearchEngine.search_tools() returns string when no results found"""
        search_engine = ToolSearchEngine()
        search_engine.is_indexed = True

        # Mock the search method to return empty results
        search_engine.search = Mock(return_value=[])

        # Call search_tools - should return formatted string
        result = await search_engine.search_tools("test query", top_k=5)

        # Verify return type is string
        assert isinstance(result, str), f"Expected str, got {type(result)}"
        assert "No relevant tools found" in result

    async def test_tool_search_engine_not_indexed_scenario(self):
        """Test search_tools when not indexed (reproduces the original bug scenario)"""
        search_engine = ToolSearchEngine()
        search_engine.is_indexed = False

        # This scenario would trigger the "still preparing" message
        result = await search_engine.search_tools("test query", top_k=5)

        # Should return string, not cause tuple unpacking error
        assert isinstance(result, str), f"Expected str, got {type(result)}"
        assert "still preparing" in result

    async def test_search_tools_tool_arun_with_string_result(self):
        """Test SearchToolsTool._arun() handles string results correctly (core bug scenario)"""
        # Create SearchToolsTool with mock dependencies
        search_tool = SearchToolsTool(self.mock_server_manager)

        # Mock the search_tool instance to return a string (as it should after the fix)
        mock_search_engine = Mock()
        mock_search_engine.search_tools = AsyncMock(return_value="Mock search results string")
        search_tool._search_tool = mock_search_engine

        # This call should NOT raise "ValueError: not enough values to unpack (expected 3, got 1)"
        result = await search_tool._arun("test query", top_k=5)

        # Should return the string directly, not try to format it again
        assert isinstance(result, str)
        assert result == "Mock search results string"

    async def test_search_tools_tool_integration_scenario(self):
        """Integration test simulating the exact scenario from issue #138"""
        # Set up SearchToolsTool as it would be used in MCPAgent with server manager
        search_tool = SearchToolsTool(self.mock_server_manager)

        # Create a ToolSearchEngine instance with mocked server_tools
        search_engine = ToolSearchEngine(server_manager=self.mock_server_manager)
        search_engine.is_indexed = False  # This triggers the "still preparing" scenario

        # Mock the server_tools to avoid iteration error
        self.mock_server_manager._server_tools = {}
        # Mock the prefetch method to avoid await error
        self.mock_server_manager._prefetch_server_tools = AsyncMock()

        search_tool._search_tool = search_engine

        # This exact call pattern was causing the tuple unpacking error in issue #138
        try:
            result = await search_tool._arun("How do I create an agent using Vapi Python SDK?", top_k=100)

            # Should succeed and return a string
            assert isinstance(result, str), f"Expected str, got {type(result)}"
            assert len(result) > 0, "Result should not be empty"

        except ValueError as e:
            if "not enough values to unpack (expected 3, got 1)" in str(e):
                pytest.fail("Issue #138 regression detected: tuple unpacking error occurred")
            else:
                # Re-raise other ValueErrors
                raise

    @patch("mcp_use.managers.tools.search_tools.logger")
    def test_format_search_results_method_exists(self, mock_logger):
        """Test that _format_search_results method exists and works correctly"""
        search_engine = ToolSearchEngine()

        # Test with mock results
        mock_tool = MockTool()
        test_results = [(mock_tool, "test_server", 0.95)]

        formatted = search_engine._format_search_results(test_results)

        assert isinstance(formatted, str)
        assert "Search results" in formatted
        assert "mock_tool" in formatted
        assert "test_server" in formatted
        assert "95.0%" in formatted

    def test_format_search_results_empty_list(self):
        """Test _format_search_results with empty list"""
        search_engine = ToolSearchEngine()

        formatted = search_engine._format_search_results([])

        assert isinstance(formatted, str)
        assert "Search results" in formatted

    @patch("mcp_use.managers.tools.search_tools.logger")
    async def test_server_manager_active_server_marking(self, mock_logger):
        """Test that active server is properly marked in results"""
        search_engine = ToolSearchEngine()
        search_engine.is_indexed = True

        # Mock search results
        mock_tool = MockTool()
        search_results = [(mock_tool, "test_server", 0.95)]
        search_engine.search = Mock(return_value=search_results)

        # Call with active_server parameter
        result = await search_engine.search_tools("test query", active_server="test_server")

        assert isinstance(result, str)
        assert "(ACTIVE)" in result, "Active server should be marked"

    def test_search_tools_input_validation(self):
        """Test ToolSearchInput validation"""
        # Valid input
        valid_input = ToolSearchInput(query="test query", top_k=50)
        assert valid_input.query == "test query"
        assert valid_input.top_k == 50

        # Default top_k
        default_input = ToolSearchInput(query="test")
        assert default_input.top_k == 100
