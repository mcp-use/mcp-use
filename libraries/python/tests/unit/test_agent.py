"""
Unit tests for the MCPAgent class.
"""

from unittest.mock import MagicMock, patch

import pytest
from langchain.schema import HumanMessage
from langchain_core.agents import AgentFinish

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
        assert agent._agent is None
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
        """When not initialized, stream calls initialize, sets max_steps, and yields final output on AgentFinish."""
        llm = self._mock_llm()
        client = MagicMock(spec=MCPClient)
        agent = MCPAgent(llm=llm, client=client)
        agent.callbacks = []
        agent.telemetry = MagicMock()

        executor = MagicMock()
        executor.max_iterations = None

        async def _init_side_effect():
            agent._agent = executor
            agent._initialized = True

        with patch.object(MCPAgent, "initialize", side_effect=_init_side_effect) as mock_init:

            async def _atake_next_step(**kwargs):
                return AgentFinish(return_values={"output": "done"}, log="")

            executor._atake_next_step = MagicMock(side_effect=_atake_next_step)

            outputs = []
            async for item in agent.stream("q", max_steps=3):
                outputs.append(item)

            mock_init.assert_called_once()
            assert executor.max_iterations == 3
            assert outputs[-1] == "done"
            agent.telemetry.track_agent_execution.assert_called_once()

    @pytest.mark.asyncio
    async def test_stream_uses_external_history_and_sets_max_steps(self):
        """External history should be used, and executor.max_iterations should reflect max_steps arg."""
        llm = self._mock_llm()
        client = MagicMock(spec=MCPClient)
        agent = MCPAgent(llm=llm, client=client)
        agent.callbacks = []
        agent.telemetry = MagicMock()

        external_history = [HumanMessage(content="past")]

        executor = MagicMock()
        executor.max_iterations = None

        async def _init_side_effect():
            agent._agent = executor
            agent._initialized = True

        with patch.object(MCPAgent, "initialize", side_effect=_init_side_effect):

            async def _asserting_step(
                name_to_tool_map=None, color_mapping=None, inputs=None, intermediate_steps=None, run_manager=None
            ):
                assert inputs["chat_history"] == [msg for msg in external_history]
                return AgentFinish(return_values={"output": "ok"}, log="")

            executor._atake_next_step = MagicMock(side_effect=_asserting_step)

            outputs = []
            async for item in agent.stream("query", max_steps=4, external_history=external_history):
                outputs.append(item)

            assert executor.max_iterations == 4
            assert outputs[-1] == "ok"
