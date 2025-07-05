"""
Unit tests for MCPAgent retry/continue functionality.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain.schema import BaseMessage, HumanMessage, SystemMessage
from langchain.schema.language_model import BaseLanguageModel
from langchain_core.exceptions import OutputParserException

from mcp_use.agents.mcpagent import MCPAgent
from mcp_use.client import MCPClient
from mcp_use.connectors.base import BaseConnector


class TestMCPAgentRetryLogic:
    """Tests for MCPAgent retry and continue functionality."""

    def test_retry_parameters_initialization(self):
        """Test that retry parameters are properly initialized."""
        llm = MagicMock(spec=BaseLanguageModel)
        client = MagicMock(spec=MCPClient)
        
        # Test default values
        agent = MCPAgent(llm=llm, client=client)
        assert agent.max_retries == 0
        assert agent.retry_delay == 1.0
        assert agent.continue_on_error is False
        assert agent.retryable_errors == [Exception]
        
        # Test custom values
        agent = MCPAgent(
            llm=llm, 
            client=client, 
            max_retries=3, 
            retry_delay=2.5, 
            continue_on_error=True,
            retryable_errors=[ValueError, RuntimeError]
        )
        assert agent.max_retries == 3
        assert agent.retry_delay == 2.5
        assert agent.continue_on_error is True
        assert agent.retryable_errors == [ValueError, RuntimeError]

    @pytest.mark.asyncio
    @patch('mcp_use.agents.mcpagent.LangChainAdapter')
    async def test_retry_on_exception_success(self, mock_adapter):
        """Test successful retry after initial exception."""
        llm = MagicMock(spec=BaseLanguageModel)
        client = MagicMock(spec=MCPClient)
        
        # Mock the client methods
        client.get_all_active_sessions.return_value = {}
        client.create_all_sessions = AsyncMock(return_value={})
        
        # Mock the adapter
        mock_adapter_instance = MagicMock()
        mock_adapter.return_value = mock_adapter_instance
        mock_adapter_instance.create_tools = AsyncMock(return_value=[])
        
        agent = MCPAgent(llm=llm, client=client, max_retries=2, retry_delay=0.1)
        
        # Mock the agent executor
        mock_agent_executor = MagicMock()
        mock_agent_executor.max_iterations = 5
        
        # Mock _atake_next_step to fail once, then succeed
        from langchain_core.agents import AgentFinish
        mock_agent_executor._atake_next_step = AsyncMock(
            side_effect=[
                Exception("First attempt fails"),
                AgentFinish(return_values={"output": "Success on retry"}, log="")
            ]
        )
        
        agent._agent_executor = mock_agent_executor
        agent._tools = []
        agent._initialized = True
        
        # Test run method
        result = await agent.run("test query")
        
        # Verify that it succeeded on retry
        assert result == "Success on retry"
        assert mock_agent_executor._atake_next_step.call_count == 2

    @pytest.mark.asyncio
    @patch('mcp_use.agents.mcpagent.LangChainAdapter')
    async def test_retry_exhausted_stops_execution(self, mock_adapter):
        """Test that execution stops after max retries are exhausted."""
        llm = MagicMock(spec=BaseLanguageModel)
        client = MagicMock(spec=MCPClient)
        
        # Mock the client methods
        client.get_all_active_sessions.return_value = {}
        client.create_all_sessions = AsyncMock(return_value={})
        
        # Mock the adapter
        mock_adapter_instance = MagicMock()
        mock_adapter.return_value = mock_adapter_instance
        mock_adapter_instance.create_tools = AsyncMock(return_value=[])
        
        agent = MCPAgent(llm=llm, client=client, max_retries=2, retry_delay=0.1)
        
        # Mock the agent executor
        mock_agent_executor = MagicMock()
        mock_agent_executor.max_iterations = 5
        
        # Mock _atake_next_step to always fail
        mock_agent_executor._atake_next_step = AsyncMock(
            side_effect=Exception("Always fails")
        )
        
        agent._agent_executor = mock_agent_executor
        agent._tools = []
        agent._initialized = True
        
        # Test run method
        result = await agent.run("test query")
        
        # Verify that it tried max_retries + 1 times and then stopped
        assert mock_agent_executor._atake_next_step.call_count == 3  # 1 initial + 2 retries
        assert "Agent stopped due to an error" in result

    @pytest.mark.asyncio
    @patch('mcp_use.agents.mcpagent.LangChainAdapter')
    async def test_continue_on_error_functionality(self, mock_adapter):
        """Test that agent continues execution when continue_on_error is True."""
        llm = MagicMock(spec=BaseLanguageModel)
        client = MagicMock(spec=MCPClient)
        
        # Mock the client methods
        client.get_all_active_sessions.return_value = {}
        client.create_all_sessions = AsyncMock(return_value={})
        
        # Mock the adapter
        mock_adapter_instance = MagicMock()
        mock_adapter.return_value = mock_adapter_instance
        mock_adapter_instance.create_tools = AsyncMock(return_value=[])
        
        agent = MCPAgent(llm=llm, client=client, continue_on_error=True, max_steps=3)
        
        # Mock the agent executor
        mock_agent_executor = MagicMock()
        mock_agent_executor.max_iterations = 3
        
        # Mock _atake_next_step to fail on first step, succeed on second
        from langchain_core.agents import AgentFinish
        mock_agent_executor._atake_next_step = AsyncMock(
            side_effect=[
                Exception("First step fails"),
                AgentFinish(return_values={"output": "Success on second step"}, log="")
            ]
        )
        
        agent._agent_executor = mock_agent_executor
        agent._tools = []
        agent._initialized = True
        
        # Test run method
        result = await agent.run("test query")
        
        # Verify that it continued after the error and succeeded
        assert result == "Success on second step"
        assert mock_agent_executor._atake_next_step.call_count == 2

    @pytest.mark.asyncio
    @patch('mcp_use.agents.mcpagent.LangChainAdapter')
    async def test_specific_error_types_for_retry(self, mock_adapter):
        """Test that only specific error types trigger retries."""
        llm = MagicMock(spec=BaseLanguageModel)
        client = MagicMock(spec=MCPClient)
        
        # Mock the client methods
        client.get_all_active_sessions.return_value = {}
        client.create_all_sessions = AsyncMock(return_value={})
        
        # Mock the adapter
        mock_adapter_instance = MagicMock()
        mock_adapter.return_value = mock_adapter_instance
        mock_adapter_instance.create_tools = AsyncMock(return_value=[])
        
        # Configure to only retry on ValueError
        agent = MCPAgent(llm=llm, client=client, max_retries=2, retryable_errors=[ValueError])
        
        # Mock the agent executor
        mock_agent_executor = MagicMock()
        mock_agent_executor.max_iterations = 5
        
        # Mock _atake_next_step to fail with RuntimeError (not retryable)
        mock_agent_executor._atake_next_step = AsyncMock(
            side_effect=RuntimeError("Not retryable")
        )
        
        agent._agent_executor = mock_agent_executor
        agent._tools = []
        agent._initialized = True
        
        # Test run method
        result = await agent.run("test query")
        
        # Verify that it didn't retry (only called once)
        assert mock_agent_executor._atake_next_step.call_count == 1
        assert "Agent stopped due to an error" in result

    @pytest.mark.asyncio
    @patch('mcp_use.agents.mcpagent.LangChainAdapter')
    async def test_output_parser_exception_retry(self, mock_adapter):
        """Test retry functionality with OutputParserException."""
        llm = MagicMock(spec=BaseLanguageModel)
        client = MagicMock(spec=MCPClient)
        
        # Mock the client methods
        client.get_all_active_sessions.return_value = {}
        client.create_all_sessions = AsyncMock(return_value={})
        
        # Mock the adapter
        mock_adapter_instance = MagicMock()
        mock_adapter.return_value = mock_adapter_instance
        mock_adapter_instance.create_tools = AsyncMock(return_value=[])
        
        agent = MCPAgent(llm=llm, client=client, max_retries=1, retry_delay=0.1)
        
        # Mock the agent executor
        mock_agent_executor = MagicMock()
        mock_agent_executor.max_iterations = 5
        
        # Mock _atake_next_step to fail with OutputParserException, then succeed
        from langchain_core.agents import AgentFinish
        mock_agent_executor._atake_next_step = AsyncMock(
            side_effect=[
                OutputParserException("Parser error"),
                AgentFinish(return_values={"output": "Success after parser error"}, log="")
            ]
        )
        
        agent._agent_executor = mock_agent_executor
        agent._tools = []
        agent._initialized = True
        
        # Test run method
        result = await agent.run("test query")
        
        # Verify that it succeeded on retry
        assert result == "Success after parser error"
        assert mock_agent_executor._atake_next_step.call_count == 2

    @pytest.mark.asyncio
    @patch('mcp_use.agents.mcpagent.LangChainAdapter')
    async def test_retry_delay_functionality(self, mock_adapter):
        """Test that retry delay is respected."""
        llm = MagicMock(spec=BaseLanguageModel)
        client = MagicMock(spec=MCPClient)
        
        # Mock the client methods
        client.get_all_active_sessions.return_value = {}
        client.create_all_sessions = AsyncMock(return_value={})
        
        # Mock the adapter
        mock_adapter_instance = MagicMock()
        mock_adapter.return_value = mock_adapter_instance
        mock_adapter_instance.create_tools = AsyncMock(return_value=[])
        
        agent = MCPAgent(llm=llm, client=client, max_retries=1, retry_delay=0.5)
        
        # Mock the agent executor
        mock_agent_executor = MagicMock()
        mock_agent_executor.max_iterations = 5
        
        # Mock _atake_next_step to fail once, then succeed
        from langchain_core.agents import AgentFinish
        mock_agent_executor._atake_next_step = AsyncMock(
            side_effect=[
                Exception("First attempt fails"),
                AgentFinish(return_values={"output": "Success on retry"}, log="")
            ]
        )
        
        agent._agent_executor = mock_agent_executor
        agent._tools = []
        agent._initialized = True
        
        # Test run method and measure time
        import time
        start_time = time.time()
        result = await agent.run("test query")
        end_time = time.time()
        
        # Verify that it succeeded and took at least the retry delay
        assert result == "Success on retry"
        assert end_time - start_time >= 0.5  # Should take at least 0.5 seconds due to retry delay
        assert mock_agent_executor._atake_next_step.call_count == 2

    @pytest.mark.asyncio
    @patch('mcp_use.agents.mcpagent.LangChainAdapter')
    async def test_zero_retry_delay(self, mock_adapter):
        """Test that zero retry delay works correctly."""
        llm = MagicMock(spec=BaseLanguageModel)
        client = MagicMock(spec=MCPClient)
        
        # Mock the client methods
        client.get_all_active_sessions.return_value = {}
        client.create_all_sessions = AsyncMock(return_value={})
        
        # Mock the adapter
        mock_adapter_instance = MagicMock()
        mock_adapter.return_value = mock_adapter_instance
        mock_adapter_instance.create_tools = AsyncMock(return_value=[])
        
        agent = MCPAgent(llm=llm, client=client, max_retries=1, retry_delay=0)
        
        # Mock the agent executor
        mock_agent_executor = MagicMock()
        mock_agent_executor.max_iterations = 5
        
        # Mock _atake_next_step to fail once, then succeed
        from langchain_core.agents import AgentFinish
        mock_agent_executor._atake_next_step = AsyncMock(
            side_effect=[
                Exception("First attempt fails"),
                AgentFinish(return_values={"output": "Success on retry"}, log="")
            ]
        )
        
        agent._agent_executor = mock_agent_executor
        agent._tools = []
        agent._initialized = True
        
        # Test run method
        result = await agent.run("test query")
        
        # Verify that it succeeded without delay
        assert result == "Success on retry"
        assert mock_agent_executor._atake_next_step.call_count == 2