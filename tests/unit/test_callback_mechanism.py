"""
Unit tests for the callback mechanism in MCPAgent.
"""

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock, Mock

import pytest
from langchain_core.tools import BaseTool

from mcp_use.adapters.langchain_adapter import LangChainAdapter
from mcp_use.agents.mcpagent import MCPAgent
from mcp_use.connectors.base import BaseConnector
from mcp_use.types import AgentCallbacks, AgentOptions


class TestCallbackMechanism:
    """Test the callback mechanism in MCPAgent."""

    def test_agent_options_initialization(self):
        """Test that agent options and callbacks are properly initialized."""
        # Mock dependencies
        mock_llm = Mock()
        mock_connector = Mock(spec=BaseConnector)

        # Create callbacks
        on_tool_start = Mock()
        on_tool_complete = Mock()
        on_tool_error = Mock()

        callbacks: AgentCallbacks = {
            "on_tool_start": on_tool_start,
            "on_tool_complete": on_tool_complete,
            "on_tool_error": on_tool_error,
        }

        options: AgentOptions = {"callbacks": callbacks}

        # Create agent with options
        agent = MCPAgent(llm=mock_llm, connectors=[mock_connector], options=options)

        # Verify options and callbacks are stored
        assert agent.options == options
        assert agent.callbacks == callbacks
        assert agent.adapter.callbacks == callbacks

    def test_agent_without_options(self):
        """Test that agent works without options parameter."""
        # Mock dependencies
        mock_llm = Mock()
        mock_connector = Mock(spec=BaseConnector)

        # Create agent without options
        agent = MCPAgent(llm=mock_llm, connectors=[mock_connector])

        # Verify defaults
        assert agent.options == {}
        assert agent.callbacks == {}
        assert agent.adapter.callbacks == {}

    @pytest.mark.asyncio
    async def test_callback_invocation_on_tool_execution(self):
        """Test that callbacks are invoked during tool execution."""
        # Create mock callbacks
        on_tool_start = Mock()
        on_tool_complete = Mock()
        on_tool_error = Mock()

        callbacks = {
            "on_tool_start": on_tool_start,
            "on_tool_complete": on_tool_complete,
            "on_tool_error": on_tool_error,
        }

        # Create adapter with callbacks
        adapter = LangChainAdapter(callbacks=callbacks)

        # Create a mock MCP tool
        mock_tool = Mock()
        mock_tool.name = "test_tool"
        mock_tool.description = "A test tool"
        mock_tool.inputSchema = {"type": "object", "properties": {}}

        # Create a mock connector
        mock_connector = Mock(spec=BaseConnector)
        mock_call_tool_result = Mock()
        mock_call_tool_result.isError = False
        mock_call_tool_result.content = [Mock(type="text", text="Tool result")]
        mock_connector.call_tool = AsyncMock(return_value=mock_call_tool_result)

        # Convert the tool
        langchain_tool = adapter._convert_tool(mock_tool, mock_connector)

        # Execute the tool
        test_input = {"test_param": "test_value"}
        result = await langchain_tool._arun(**test_input)

        # Verify callbacks were called
        on_tool_start.assert_called_once_with("test_tool", test_input)
        on_tool_complete.assert_called_once_with("test_tool", test_input, "Tool result")
        on_tool_error.assert_not_called()

        assert result == "Tool result"

    @pytest.mark.asyncio
    async def test_callback_invocation_on_tool_error(self):
        """Test that error callback is invoked when tool execution fails."""
        # Create mock callbacks
        on_tool_start = Mock()
        on_tool_complete = Mock()
        on_tool_error = Mock()

        callbacks = {
            "on_tool_start": on_tool_start,
            "on_tool_complete": on_tool_complete,
            "on_tool_error": on_tool_error,
        }

        # Create adapter with callbacks
        adapter = LangChainAdapter(callbacks=callbacks)

        # Create a mock MCP tool
        mock_tool = Mock()
        mock_tool.name = "test_tool"
        mock_tool.description = "A test tool"
        mock_tool.inputSchema = {"type": "object", "properties": {}}

        # Create a mock connector that raises an error
        mock_connector = Mock(spec=BaseConnector)
        test_error = Exception("Tool execution failed")
        mock_connector.call_tool = AsyncMock(side_effect=test_error)

        # Convert the tool
        langchain_tool = adapter._convert_tool(mock_tool, mock_connector)

        # Execute the tool
        test_input = {"test_param": "test_value"}
        result = await langchain_tool._arun(**test_input)

        # Verify callbacks were called correctly
        on_tool_start.assert_called_once_with("test_tool", test_input)
        on_tool_complete.assert_not_called()
        on_tool_error.assert_called_once_with("test_tool", test_input, test_error)

        # Since handle_tool_error is True, should return error message instead of raising
        assert "Error executing MCP tool" in result

    def test_callback_error_handling(self):
        """Test that errors in callbacks don't break tool execution."""
        # Create mock callbacks that raise errors
        on_tool_start = Mock(side_effect=Exception("Callback error"))

        callbacks = {
            "on_tool_start": on_tool_start,
        }

        # Create adapter with callbacks
        adapter = LangChainAdapter(callbacks=callbacks)

        # This should not raise an exception during tool creation
        mock_tool = Mock()
        mock_tool.name = "test_tool"
        mock_tool.description = "A test tool"
        mock_tool.inputSchema = {"type": "object", "properties": {}}

        mock_connector = Mock(spec=BaseConnector)

        # Should not raise an exception
        langchain_tool = adapter._convert_tool(mock_tool, mock_connector)
        assert langchain_tool is not None
