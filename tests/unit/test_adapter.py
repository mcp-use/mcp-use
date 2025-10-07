"""
Unit tests for LangChainAdapter.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages.tool import ToolMessage

from mcp_use.adapters.langchain_adapter import LangChainAdapter
from mcp_use.agents.mcpagent import MCPAgent
from mcp_use.connectors.base import BaseConnector


class TestLangChainAdapterToolCallIDManagement:
    """Tests for Tool Call ID Management in LangChainAdapter."""

    def _mock_connector(self):
        """Create a mock connector for testing."""
        connector = MagicMock(spec=BaseConnector)
        connector.call_tool = AsyncMock()
        connector.is_connected = True
        return connector

    def _mock_agent(self):
        """Create a mock agent for testing."""
        agent = MagicMock(spec=MCPAgent)
        agent._generate_tool_call_id = MagicMock(return_value="call_abc12345")
        agent._create_tool_message = MagicMock()
        agent.add_to_history = MagicMock()
        agent.memory_enabled = True
        return agent

    @pytest.mark.asyncio
    async def test_tool_execution_generates_and_stores_tool_call_id(self):
        """Test that tool execution generates tool_call_id and creates ToolMessage."""
        connector = self._mock_connector()
        agent = self._mock_agent()
        adapter = LangChainAdapter(agent=agent)

        # Mock tool result
        mock_result = MagicMock()
        mock_result.isError = False
        mock_result.content = [{"type": "text", "text": "Tool execution result"}]

        connector.call_tool = AsyncMock(return_value=mock_result)

        # Create a tool
        mcp_tool = MagicMock()
        mcp_tool.name = "test_tool"
        mcp_tool.description = "A test tool"
        mcp_tool.inputSchema = {"type": "object", "properties": {"arg1": {"type": "string"}}}

        tool = adapter._convert_tool(mcp_tool, connector)

        result = await tool._arun(arg1="test_value")

        # Verify core functionality:
        # 1. Tool call ID was generated
        agent._generate_tool_call_id.assert_called_once()

        # 2. ToolMessage was created with the ID
        agent._create_tool_message.assert_called_once_with(
            "call_abc12345", "[{'type': 'text', 'text': 'Tool execution result'}]"
        )

        # 3. ToolMessage was added to conversation history
        agent.add_to_history.assert_called_once()

        # 4. Tool execution returned correct result
        assert result == "[{'type': 'text', 'text': 'Tool execution result'}]"

    @pytest.mark.asyncio
    async def test_tool_execution_handles_errors_with_tool_call_id(self):
        """Test that tool execution errors are handled and still create ToolMessage."""
        connector = self._mock_connector()
        agent = self._mock_agent()
        adapter = LangChainAdapter(agent=agent)

        # Mock tool error
        connector.call_tool = AsyncMock(side_effect=Exception("Tool execution failed"))

        # Create a tool
        mcp_tool = MagicMock()
        mcp_tool.name = "test_tool"
        mcp_tool.description = "A test tool"
        mcp_tool.inputSchema = {"type": "object"}

        tool = adapter._convert_tool(mcp_tool, connector)

        # Execute the tool
        result = await tool._arun()

        # Verify error handling:
        # 1. Tool call ID was still generated
        agent._generate_tool_call_id.assert_called_once()

        # 2. ToolMessage was created with error content
        agent._create_tool_message.assert_called_once()
        agent.add_to_history.assert_called_once()

        # 3. Error was handled gracefully
        assert isinstance(result, dict)
        assert result.get("details") == "Tool execution failed"

    def test_adapter_without_agent_works_normally(self):
        """Test that adapter works normally when no agent reference is provided."""
        connector = self._mock_connector()
        adapter = LangChainAdapter()

        # Mock tool result
        mock_result = MagicMock()
        mock_result.isError = False
        mock_result.content = [{"type": "text", "text": "Tool execution result"}]

        connector.call_tool = AsyncMock(return_value=mock_result)

        # Create a tool
        mcp_tool = MagicMock()
        mcp_tool.name = "test_tool"
        mcp_tool.description = "A test tool"
        mcp_tool.inputSchema = {"type": "object"}

        tool = adapter._convert_tool(mcp_tool, connector)

        # Verify tool was created normally
        assert tool is not None
        assert tool.name == "test_tool"
        assert tool.description == "A test tool"
        assert tool.tool_connector is connector
