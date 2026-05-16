"""
Unit tests for MCPAgent analysis summary generation.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from mcp_use.agents.mcpagent import MCPAgent
from mcp_use.client import MCPClient


class TestMCPAgentAnalysisSummary:
    """Tests for MCPAgent._generate_analysis_summary"""

    def _mock_llm(self):
        llm = MagicMock()
        llm._llm_type = "test-provider"
        llm._identifying_params = {"model": "test-model"}
        return llm

    @pytest.mark.asyncio
    async def test_generate_analysis_summary_success(self):
        """_generate_analysis_summary should invoke LLM and return summary string."""
        llm = self._mock_llm()
        client = MagicMock(spec=MCPClient)
        agent = MCPAgent(llm=llm, client=client)

        # Mock LLM response
        mock_response = MagicMock()
        mock_response.content = "Summary: The agent executed 2 tool calls and reached a conclusion."
        llm.ainvoke = AsyncMock(return_value=mock_response)

        messages = [
            HumanMessage(content="What is 2+2?"),
            AIMessage(
                content="I'll calculate this.",
                tool_calls=[{"name": "add", "args": {"a": 2, "b": 2}, "id": "call_1"}],
            ),
            ToolMessage(content="4", tool_call_id="call_1"),
            AIMessage(content="The result is 4."),
        ]

        summary = await agent._generate_analysis_summary(messages)

        assert isinstance(summary, str)
        assert "Summary" in summary
        llm.ainvoke.assert_called_once()

        # Verify the prompt contains the log information
        call_args = llm.ainvoke.call_args
        prompt = call_args[0][0]
        assert "analysis optimizer" in prompt.lower()
        assert "logs" in prompt.lower()

    @pytest.mark.asyncio
    async def test_generate_analysis_summary_handles_string_response(self):
        """_generate_analysis_summary should handle string responses from LLM."""
        llm = self._mock_llm()
        client = MagicMock(spec=MCPClient)
        agent = MCPAgent(llm=llm, client=client)

        # Mock LLM response as plain string
        llm.ainvoke = AsyncMock(return_value="Direct string response")

        messages = [HumanMessage(content="Test query")]

        summary = await agent._generate_analysis_summary(messages)

        assert summary == "Direct string response"

    @pytest.mark.asyncio
    async def test_generate_analysis_summary_handles_exception(self):
        """_generate_analysis_summary should gracefully fall back on LLM error."""
        llm = self._mock_llm()
        client = MagicMock(spec=MCPClient)
        agent = MCPAgent(llm=llm, client=client)

        # Mock LLM to raise an exception
        llm.ainvoke = AsyncMock(side_effect=Exception("LLM call failed"))

        messages = [HumanMessage(content="Test query")]

        summary = await agent._generate_analysis_summary(messages)

        # Should return fallback message
        assert summary == "Summary generation unavailable. Please review raw data logs."
        llm.ainvoke.assert_called_once()

    @pytest.mark.asyncio
    async def test_generate_analysis_summary_with_empty_messages(self):
        """_generate_analysis_summary should handle empty message list gracefully."""
        llm = self._mock_llm()
        client = MagicMock(spec=MCPClient)
        agent = MCPAgent(llm=llm, client=client)

        # Mock LLM response
        mock_response = MagicMock()
        mock_response.content = "No messages provided."
        llm.ainvoke = AsyncMock(return_value=mock_response)

        messages = []

        summary = await agent._generate_analysis_summary(messages)

        assert isinstance(summary, str)
        llm.ainvoke.assert_called_once()

    @pytest.mark.asyncio
    async def test_generate_analysis_summary_with_complex_messages(self):
        """_generate_analysis_summary should normalize complex message content."""
        llm = self._mock_llm()
        client = MagicMock(spec=MCPClient)
        agent = MCPAgent(llm=llm, client=client)

        # Mock LLM response
        mock_response = MagicMock()
        mock_response.content = "Complex analysis summary."
        llm.ainvoke = AsyncMock(return_value=mock_response)

        # Create messages with various content types
        messages = [
            HumanMessage(content="Query"),
            AIMessage(
                content=[
                    {"type": "text", "text": "Multi-part response"},
                    {"type": "text", "text": " continued"},
                ]
            ),
            ToolMessage(content="Tool output", tool_call_id="call_1"),
        ]

        summary = await agent._generate_analysis_summary(messages)

        assert isinstance(summary, str)
        llm.ainvoke.assert_called_once()

    @pytest.mark.asyncio
    async def test_stream_yields_final_payload_with_analysis(self):
        """stream() should yield final payload dict with output and analysis keys."""
        llm = self._mock_llm()
        client = MagicMock(spec=MCPClient)
        agent = MCPAgent(llm=llm, client=client, max_steps=5)
        agent.callbacks = []
        agent.telemetry = MagicMock()

        # Mock the agent executor
        executor = MagicMock()
        agent._agent_executor = executor
        agent._initialized = True

        # Mock LLM for analysis summary
        mock_summary_response = MagicMock()
        mock_summary_response.content = "Agent performed calculations."
        llm.ainvoke = AsyncMock(return_value=mock_summary_response)

        # Mock astream to return minimal execution as async generator
        async def mock_astream(inputs, stream_mode=None, config=None):
            yield {"agent": {"messages": [AIMessage(content="Result is 42")]}}

        # Use AsyncMock with side_effect to return async generator
        executor.astream = MagicMock(side_effect=mock_astream)

        outputs = []
        async for item in agent.stream("What is the answer?", manage_connector=False):
            outputs.append(item)

        # Verify final output is a dict with output and analysis
        final_output = outputs[-1]
        assert isinstance(final_output, dict), f"Expected dict, got {type(final_output)}"
        assert "output" in final_output, f"'output' not in {final_output.keys()}"
        assert "analysis" in final_output, f"'analysis' not in {final_output.keys()}"
        assert final_output["output"] == "Result is 42"
        assert final_output["analysis"] == "Agent performed calculations."

    @pytest.mark.asyncio
    async def test_stream_analysis_fallback_on_error(self):
        """stream() should include fallback analysis message if summary generation fails."""
        llm = self._mock_llm()
        client = MagicMock(spec=MCPClient)
        agent = MCPAgent(llm=llm, client=client, max_steps=5)
        agent.callbacks = []
        agent.telemetry = MagicMock()

        # Mock the agent executor
        executor = MagicMock()
        agent._agent_executor = executor
        agent._initialized = True

        # Mock LLM to fail during summary generation
        llm.ainvoke = AsyncMock(side_effect=Exception("Summary generation failed"))

        # Mock astream to return minimal execution as async generator
        async def mock_astream(inputs, stream_mode=None, config=None):
            yield {"agent": {"messages": [AIMessage(content="Result")]}}

        executor.astream = MagicMock(side_effect=mock_astream)

        outputs = []
        async for item in agent.stream("What is the answer?", manage_connector=False):
            outputs.append(item)

        # Verify final output includes fallback analysis
        final_output = outputs[-1]
        assert isinstance(final_output, dict), f"Expected dict, got {type(final_output)}"
        assert "output" in final_output, f"'output' not in {final_output.keys()}"
        assert "analysis" in final_output, f"'analysis' not in {final_output.keys()}"
        assert final_output["analysis"] == "Summary generation unavailable. Please review raw data logs."
