"""
Unit tests for MCPAgent observability integration.
"""

from unittest.mock import AsyncMock, Mock, patch

import pytest

from mcp_use.agents.mcpagent import MCPAgent
from mcp_use.observability.manager import ObservabilityManager
from mcp_use.observability.types import LangfuseObservabilityConfig


class TestMCPAgentObservability:
    """Test MCPAgent integration with observability."""

    def test_mcpagent_initialization_no_observability(self):
        """Test MCPAgent initialization without observability."""
        mock_client = Mock()
        llm = Mock()

        agent = MCPAgent(llm=llm, client=mock_client)

        assert agent.observability_manager is not None
        assert isinstance(agent.observability_manager, ObservabilityManager)
        assert not agent.observability_manager.is_any_provider_enabled()

    def test_mcpagent_initialization_with_langfuse_config(self):
        """Test MCPAgent initialization with Langfuse configuration."""
        mock_client = Mock()
        llm = Mock()

        observability_config = {
            "langfuse": LangfuseObservabilityConfig(enabled=True, trace_level="detailed", session_id="test_session")
        }

        with patch("mcp_use.observability.manager.configure_langfuse") as mock_configure:
            agent = MCPAgent(llm=llm, client=mock_client, observability=observability_config)

            assert agent.observability_manager is not None
            assert agent.observability_manager.is_any_provider_enabled()
            mock_configure.assert_called_once()

    def test_mcpagent_initialization_with_dict_config(self):
        """Test MCPAgent initialization with dictionary-based observability configuration."""
        mock_client = Mock()
        llm = Mock()

        observability_config = {
            "langfuse": {
                "enabled": True,
                "trace_level": "verbose",
                "capture_tool_inputs": False,
                "session_id": "dict_session",
            }
        }

        with patch("mcp_use.observability.manager.configure_langfuse"):
            agent = MCPAgent(llm=llm, client=mock_client, observability=observability_config)

            assert agent.observability_manager is not None
            assert agent.observability_manager.is_any_provider_enabled()

            # Check that the config was converted to LangfuseObservabilityConfig
            langfuse_config = agent.observability_manager.get_provider_config("langfuse")
            assert isinstance(langfuse_config, LangfuseObservabilityConfig)
            assert langfuse_config.trace_level == "verbose"
            assert langfuse_config.capture_tool_inputs is False

    def test_mcpagent_create_agent_with_callbacks(self):
        """Test that _create_agent includes observability callbacks."""
        mock_client = Mock()
        llm = Mock()

        observability_config = {"langfuse": LangfuseObservabilityConfig(enabled=True)}

        mock_callbacks = [Mock(), Mock()]

        with patch("mcp_use.observability.manager.configure_langfuse"):
            agent = MCPAgent(llm=llm, client=mock_client, observability=observability_config)

            # Mock the tools and system message for agent creation
            agent._tools = [Mock()]
            agent._system_message = Mock()
            agent._system_message.content = "Test system message"

            with patch.object(agent.observability_manager, "get_callbacks", return_value=mock_callbacks):
                with patch("mcp_use.agents.mcpagent.create_tool_calling_agent") as mock_create_agent:
                    with patch("mcp_use.agents.mcpagent.AgentExecutor") as mock_executor:
                        mock_agent = Mock()
                        mock_create_agent.return_value = mock_agent

                        agent._create_agent()

                        # Verify that AgentExecutor was called with callbacks
                        mock_executor.assert_called_once()
                        call_kwargs = mock_executor.call_args[1]
                        assert "callbacks" in call_kwargs
                        assert call_kwargs["callbacks"] == mock_callbacks

    def test_mcpagent_create_agent_no_callbacks(self):
        """Test that _create_agent works without callbacks."""
        mock_client = Mock()
        llm = Mock()

        agent = MCPAgent(llm=llm, client=mock_client)

        # Mock the tools and system message for agent creation
        agent._tools = [Mock()]
        agent._system_message = Mock()
        agent._system_message.content = "Test system message"

        with patch.object(agent.observability_manager, "get_callbacks", return_value=[]):
            with patch("mcp_use.agents.mcpagent.create_tool_calling_agent") as mock_create_agent:
                with patch("mcp_use.agents.mcpagent.AgentExecutor") as mock_executor:
                    mock_agent = Mock()
                    mock_create_agent.return_value = mock_agent

                    agent._create_agent()

                    # Verify that AgentExecutor was called with callbacks=None
                    mock_executor.assert_called_once()
                    call_kwargs = mock_executor.call_args[1]
                    assert "callbacks" in call_kwargs
                    assert call_kwargs["callbacks"] is None

    @pytest.mark.asyncio
    async def test_mcpagent_stream_events_with_callbacks(self):
        """Test that stream events includes observability callbacks."""
        mock_client = Mock()
        llm = Mock()

        observability_config = {"langfuse": LangfuseObservabilityConfig(enabled=True)}

        mock_callbacks = [Mock()]

        with patch("mcp_use.observability.manager.configure_langfuse"):
            agent = MCPAgent(llm=llm, client=mock_client, observability=observability_config)

            # Mock initialization
            agent._initialized = True
            agent._agent_executor = Mock()
            agent._agent_executor.max_iterations = 5

            # Mock astream_events to return test events
            async def mock_astream_events(inputs, config=None):
                yield {"event": "test_event", "data": {}}

            agent._agent_executor.astream_events = mock_astream_events

            with patch.object(agent.observability_manager, "get_callbacks", return_value=mock_callbacks):
                # Collect events from the stream
                events = []
                async for event in agent._generate_response_chunks_async("test query"):
                    events.append(event)

                # Verify events were generated
                assert len(events) == 1
                assert events[0]["event"] == "test_event"

    def test_mcpagent_observability_manager_property(self):
        """Test that observability_manager is properly accessible."""
        mock_client = Mock()
        llm = Mock()

        observability_config = {
            "langfuse": LangfuseObservabilityConfig(enabled=True, trace_level="detailed", session_id="property_test")
        }

        with patch("mcp_use.observability.manager.configure_langfuse"):
            agent = MCPAgent(llm=llm, client=mock_client, observability=observability_config)

            # Test that we can access the observability manager
            manager = agent.observability_manager
            assert isinstance(manager, ObservabilityManager)
            assert manager.is_any_provider_enabled()

            # Test that we can get the Langfuse configuration
            langfuse_config = manager.get_provider_config("langfuse")
            assert isinstance(langfuse_config, LangfuseObservabilityConfig)
            assert langfuse_config.session_id == "property_test"

    def test_mcpagent_backwards_compatibility(self):
        """Test that MCPAgent maintains backward compatibility when no observability is specified."""
        mock_client = Mock()
        llm = Mock()

        # This should work exactly as before
        agent = MCPAgent(llm=llm, client=mock_client, max_steps=10, memory_enabled=True, verbose=True)

        assert agent.observability_manager is not None
        assert not agent.observability_manager.is_any_provider_enabled()
        assert agent.max_steps == 10
        assert agent.memory_enabled is True
        assert agent.verbose is True

    def test_mcpagent_mixed_configuration(self):
        """Test MCPAgent with both traditional and observability configuration."""
        mock_client = Mock()
        llm = Mock()

        observability_config = {
            "langfuse": LangfuseObservabilityConfig(enabled=True, trace_level="basic", user_id="mixed_test_user")
        }

        with patch("mcp_use.observability.manager.configure_langfuse"):
            agent = MCPAgent(
                llm=llm,
                client=mock_client,
                max_steps=7,
                memory_enabled=False,
                system_prompt="Custom system prompt",
                disallowed_tools=["dangerous_tool"],
                observability=observability_config,
            )

            # Traditional settings should work
            assert agent.max_steps == 7
            assert agent.memory_enabled is False
            assert agent.system_prompt == "Custom system prompt"
            assert agent.disallowed_tools == ["dangerous_tool"]

            # Observability should also work
            assert agent.observability_manager.is_any_provider_enabled()
            langfuse_config = agent.observability_manager.get_provider_config("langfuse")
            assert langfuse_config.user_id == "mixed_test_user"

    def test_mcpagent_disabled_observability(self):
        """Test MCPAgent with explicitly disabled observability."""
        mock_client = Mock()
        llm = Mock()

        observability_config = {"langfuse": LangfuseObservabilityConfig(enabled=False)}

        with patch("mcp_use.observability.manager.configure_langfuse"):
            agent = MCPAgent(llm=llm, client=mock_client, observability=observability_config)

            assert agent.observability_manager is not None
            assert not agent.observability_manager.is_any_provider_enabled()

            # get_callbacks should return empty list
            callbacks = agent.observability_manager.get_callbacks()
            assert callbacks == []

    def test_mcpagent_observability_error_handling(self):
        """Test MCPAgent handles observability configuration errors gracefully."""
        mock_client = Mock()
        llm = Mock()

        observability_config = {"langfuse": LangfuseObservabilityConfig(enabled=True)}

        # Simulate configuration error
        with patch("mcp_use.observability.manager.configure_langfuse", side_effect=Exception("Config error")):
            # Should not raise an exception
            agent = MCPAgent(llm=llm, client=mock_client, observability=observability_config)

            # Agent should still be functional
            assert agent.observability_manager is not None
            # Even if configuration failed, manager should handle it gracefully
            callbacks = agent.observability_manager.get_callbacks()
            assert isinstance(callbacks, list)  # Should be empty list, not raise error
