"""
Unit tests for the MCPAgent class.
"""

from unittest.mock import MagicMock, patch

import pytest
from langchain_core.agents import AgentFinish
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from mcp_use.agents.mcpagent import MCPAgent
from mcp_use.client import MCPClient
from mcp_use.connectors.base import BaseConnector


class TestMCPAgentInitialization:
    """Tests for MCPAgent initialization"""

    def _mock_llm(self):
        llm = MagicMock()
        llm._llm_type = "test-provider"
        llm._identifying_params = {"model": "test-model"}
        return llm

    def test_init_with_llm_and_client(self):
        """Initializing locally with LLM and client."""
        llm = self._mock_llm()
        client = MagicMock(spec=MCPClient)

        agent = MCPAgent(llm=llm, client=client)

        assert agent.llm is llm
        assert agent.client is client
        assert agent._is_remote is False
        assert agent._initialized is False
        assert agent._agent_executor is None
        assert isinstance(agent.tools_used_names, list)

    def test_init_requires_llm_for_local(self):
        """Omitting LLM for local execution raises ValueError."""
        with pytest.raises(ValueError) as exc:
            MCPAgent(client=MagicMock(spec=MCPClient))
        assert "llm is required for local execution" in str(exc.value)

    def test_init_requires_client_or_connectors(self):
        """LLM present but no client/connectors raises ValueError."""
        llm = self._mock_llm()
        with pytest.raises(ValueError) as exc:
            MCPAgent(llm=llm)
        assert "Either client or connector must be provided" in str(exc.value)

    def test_init_with_connectors_only(self):
        """LLM with connectors initializes without client."""
        llm = self._mock_llm()
        connector = MagicMock(spec=BaseConnector)

        agent = MCPAgent(llm=llm, connectors=[connector])

        assert agent.client is None
        assert agent.connectors == [connector]
        assert agent._is_remote is False

    def test_server_manager_requires_client(self):
        """Using server manager without client raises ValueError."""
        llm = self._mock_llm()
        with pytest.raises(ValueError) as exc:
            MCPAgent(llm=llm, connectors=[MagicMock(spec=BaseConnector)], use_server_manager=True)
        assert "Client must be provided when using server manager" in str(exc.value)

    def test_init_remote_mode_with_agent_id(self):
        """Providing agent_id enables remote mode and skips local requirements."""
        with patch("mcp_use.agents.mcpagent.RemoteAgent") as MockRemote:
            agent = MCPAgent(agent_id="abc123", api_key="k", base_url="https://x")

        MockRemote.assert_called_once()
        assert agent._is_remote is True
        assert agent._remote_agent is not None


class TestMCPAgentRun:
    """Tests for MCPAgent.run"""

    def _mock_llm(self):
        llm = MagicMock()
        llm._llm_type = "test-provider"
        llm._identifying_params = {"model": "test-model"}
        llm.with_structured_output = MagicMock(return_value=llm)
        return llm

    @pytest.mark.asyncio
    async def test_run_remote_delegates(self):
        """In remote mode, run delegates to RemoteAgent.run and returns its result."""
        with patch("mcp_use.agents.mcpagent.RemoteAgent") as MockRemote:
            remote_instance = MockRemote.return_value
            remote_instance.run = MagicMock()

            async def _arun(*args, **kwargs):
                return "remote-result"

            remote_instance.run.side_effect = _arun

            agent = MCPAgent(agent_id="abc123", api_key="k", base_url="https://x")

            result = await agent.run("hello", max_steps=3, external_history=["h"], output_schema=None)

            remote_instance.run.assert_called_once()
            assert result == "remote-result"

    @pytest.mark.asyncio
    async def test_run_local_calls_stream_and_consume(self):
        """Local run creates stream generator and consumes it via _consume_and_return."""
        llm = self._mock_llm()
        client = MagicMock(spec=MCPClient)

        agent = MCPAgent(llm=llm, client=client)

        async def dummy_gen():
            if False:
                yield None

        with (
            patch.object(MCPAgent, "stream", return_value=dummy_gen()) as mock_stream,
            patch.object(MCPAgent, "_consume_and_return") as mock_consume,
        ):

            async def _aconsume(gen):
                return ("ok", 1)

            mock_consume.side_effect = _aconsume

            result = await agent.run("query", max_steps=2, manage_connector=True, external_history=None)

            mock_stream.assert_called_once()
            mock_consume.assert_called_once()
            assert result == "ok"


class TestMCPAgentStream:
    """Tests for MCPAgent.stream"""

    def _mock_llm(self):
        llm = MagicMock()
        llm._llm_type = "test-provider"
        llm._identifying_params = {"model": "test-model"}
        llm.with_structured_output = MagicMock(return_value=llm)
        return llm

    @pytest.mark.asyncio
    async def test_stream_remote_delegates(self):
        """In remote mode, stream delegates to RemoteAgent.stream and yields its items."""

        async def _astream(*args, **kwargs):
            yield "remote-yield-1"
            yield "remote-yield-2"

        with patch("mcp_use.agents.mcpagent.RemoteAgent") as MockRemote:
            remote_instance = MockRemote.return_value
            remote_instance.stream = MagicMock(side_effect=_astream)

            agent = MCPAgent(agent_id="abc123", api_key="k", base_url="https://x")

            outputs = []
            async for item in agent.stream("hello", max_steps=2):
                outputs.append(item)

            remote_instance.stream.assert_called_once()
            assert outputs == ["remote-yield-1", "remote-yield-2"]

    @pytest.mark.asyncio
    async def test_stream_initializes_and_finishes(self):
        """When not initialized, stream calls initialize and yields final output."""
        llm = self._mock_llm()
        client = MagicMock(spec=MCPClient)
        agent = MCPAgent(llm=llm, client=client)
        agent.callbacks = []
        agent.telemetry = MagicMock()

        executor = MagicMock()

        async def _init_side_effect():
            agent._agent_executor = executor
            agent._initialized = True

        async def mock_astream(inputs, stream_mode=None, config=None):
            # Simulate agent response
            yield {"agent": {"messages": [AIMessage(content="done")]}}

        executor.astream = MagicMock(side_effect=mock_astream)

        with patch.object(MCPAgent, "initialize", side_effect=_init_side_effect) as mock_init:
            outputs = []
            async for item in agent.stream("q", max_steps=3):
                outputs.append(item)

            mock_init.assert_called_once()
            assert outputs[-1] == "done"
            agent.telemetry.track_agent_execution.assert_called_once()

    @pytest.mark.asyncio
    async def test_stream_uses_external_history_and_sets_max_steps(self):
        """External history should be used in the stream."""
        llm = self._mock_llm()
        client = MagicMock(spec=MCPClient)
        agent = MCPAgent(llm=llm, client=client)
        agent.callbacks = []
        agent.telemetry = MagicMock()

        external_history = [HumanMessage(content="past")]

        executor = MagicMock()

        async def _init_side_effect():
            agent._agent_executor = executor
            agent._initialized = True

        history_was_used = False

        async def mock_astream(inputs, stream_mode=None, config=None):
            nonlocal history_was_used
            # Check that external history was included in messages
            if "messages" in inputs:
                messages = inputs["messages"]
                if any(isinstance(m, HumanMessage) and m.content == "past" for m in messages):
                    history_was_used = True
            yield {"agent": {"messages": [AIMessage(content="ok")]}}

        executor.astream = MagicMock(side_effect=mock_astream)

        with patch.object(MCPAgent, "initialize", side_effect=_init_side_effect):
            outputs = []
            async for item in agent.stream("query", max_steps=4, external_history=external_history):
                outputs.append(item)

            assert history_was_used, "External history was not used"
            assert outputs[-1] == "ok"

    @pytest.mark.asyncio
    async def test_stream_persists_tool_messages_in_history(self):
        """stream() should persist full tool exchange (AI tool_calls + ToolMessage) to history."""
        llm = self._mock_llm()
        client = MagicMock(spec=MCPClient)
        agent = MCPAgent(llm=llm, client=client, max_steps=5, memory_enabled=True)
        agent.callbacks = []
        agent.telemetry = MagicMock()

        executor = MagicMock()
        agent._agent_executor = executor
        agent._initialized = True

        async def mock_astream(inputs, stream_mode=None, config=None):
            # Tool call message (AIMessage with tool_calls)
            yield {
                "agent": {
                    "messages": [
                        AIMessage(
                            content="",
                            tool_calls=[{"name": "add", "args": {"a": 2, "b": 2}, "id": "call_1"}],
                        )
                    ]
                }
            }
            # Tool result message
            yield {"tools": {"messages": [ToolMessage(content="4", tool_call_id="call_1")]}}
            # Final assistant response
            yield {"agent": {"messages": [AIMessage(content="4")]}}

        executor.astream = MagicMock(side_effect=mock_astream)

        outputs = []
        async for item in agent.stream("Add 2 and 2 using the add tool", manage_connector=False):
            outputs.append(item)

        history = agent.get_conversation_history()

        assert len(history) >= 3, "Expected at least HumanMessage + ToolMessage + final AIMessage"
        assert isinstance(history[0], HumanMessage), "First message should be HumanMessage"
        assert any(isinstance(m, ToolMessage) and m.content == "4" for m in history), "ToolMessage not persisted"
        assert isinstance(history[-1], AIMessage), "Last message should be AIMessage"
        assert outputs[-1] == "4"

    @pytest.mark.asyncio
    async def test_stream_handles_block_tool_results_without_losing_history(self):
        """stream() should tolerate LangChain ToolMessage block content produced by richer tool outputs."""
        llm = self._mock_llm()
        client = MagicMock(spec=MCPClient)
        agent = MCPAgent(llm=llm, client=client, max_steps=5, memory_enabled=True)
        agent.callbacks = []
        agent.telemetry = MagicMock()

        executor = MagicMock()
        agent._agent_executor = executor
        agent._initialized = True

        tool_blocks = [
            {"type": "text", "text": "Computed result: 4"},
            {
                "type": "file",
                "source_type": "base64",
                "data": "ZGF0YQ==",
                "mime_type": "application/octet-stream",
            },
        ]

        async def mock_astream(inputs, stream_mode=None, config=None):
            yield {
                "agent": {
                    "messages": [
                        AIMessage(
                            content="",
                            tool_calls=[{"name": "add", "args": {"a": 2, "b": 2}, "id": "call_1"}],
                        )
                    ]
                }
            }
            yield {"tools": {"messages": [ToolMessage(content=tool_blocks, tool_call_id="call_1")]}}
            yield {"agent": {"messages": [AIMessage(content=[{"type": "text", "text": "The answer is 4"}])]}}

        executor.astream = MagicMock(side_effect=mock_astream)

        outputs = []
        async for item in agent.stream("Add 2 and 2 using the add tool", manage_connector=False):
            outputs.append(item)

        history = agent.get_conversation_history()

        assert any(isinstance(item, tuple) and "Computed result: 4" in item[1] for item in outputs), (
            "Expected streamed tool observation for block-based tool output"
        )
        assert outputs[-1] == "The answer is 4"
        assert any(isinstance(message, ToolMessage) and message.content == tool_blocks for message in history), (
            "Block-based ToolMessage should be preserved in history"
        )


class TestMCPAgentStreamEvents:
    """Tests for MCPAgent.stream_events."""

    def _mock_llm(self):
        llm = MagicMock()
        llm._llm_type = "test-provider"
        llm._identifying_params = {"model": "test-model"}
        llm.with_structured_output = MagicMock(return_value=llm)
        return llm

    @pytest.mark.asyncio
    async def test_stream_events_persists_block_tool_results_in_history(self):
        """stream_events() should preserve ToolMessages whose content is a list of LangChain blocks."""
        llm = self._mock_llm()
        client = MagicMock(spec=MCPClient)
        agent = MCPAgent(llm=llm, client=client, max_steps=5, memory_enabled=True)
        agent.callbacks = []
        agent.telemetry = MagicMock()

        executor = MagicMock()
        agent._agent_executor = executor
        agent._initialized = True

        tool_message = ToolMessage(
            content=[
                {"type": "text", "text": "tool failed, retrying"},
                {"type": "text", "text": "fallback applied"},
            ],
            tool_call_id="call_1",
        )
        ai_message = AIMessage(content=[{"type": "text", "text": "Recovered successfully"}])

        async def mock_astream_events(inputs, config=None):
            yield {"event": "on_tool_end", "data": {"output": tool_message}}
            yield {"event": "on_chat_model_end", "data": {"output": ai_message}}

        executor.astream_events = MagicMock(side_effect=mock_astream_events)

        events = []
        async for event in agent.stream_events("Recover from the tool error", manage_connector=False):
            events.append(event)

        history = agent.get_conversation_history()

        assert len(events) == 2
        assert any(
            isinstance(message, ToolMessage) and message.content == tool_message.content for message in history
        ), "Block-based ToolMessage should be stored by stream_events()"
        assert any(isinstance(message, AIMessage) and message.content == ai_message.content for message in history), (
            "Final AI message should be stored by stream_events()"
        )
