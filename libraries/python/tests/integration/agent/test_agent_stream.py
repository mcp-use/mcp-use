"""
End-to-end integration test for agent.stream().

Tests the agent.stream() method yielding incremental responses.
"""

import sys
from pathlib import Path

import pytest
from langchain_core.agents import AgentAction
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient
from mcp_use.logging import logger


@pytest.mark.asyncio
@pytest.mark.integration
async def test_agent_stream():
    """Test agent.stream() yielding incremental responses."""
    server_path = Path(__file__).parent.parent / "servers_for_testing" / "simple_server.py"

    config = {"mcpServers": {"simple": {"command": sys.executable, "args": [str(server_path), "--transport", "stdio"]}}}

    client = MCPClient.from_dict(config)
    llm = ChatOpenAI(model="gpt-4o")
    agent = MCPAgent(llm=llm, client=client, max_steps=5)

    try:
        query = "Add 10 and 20 using the add tool"
        logger.info("\n" + "=" * 80)
        logger.info("TEST: test_agent_stream")
        logger.info("=" * 80)
        logger.info(f"Query: {query}")

        chunks = []
        intermediate_steps = []
        final_result = None

        async for chunk in agent.stream(query):
            chunks.append(chunk)
            if isinstance(chunk, tuple):
                action, observation = chunk
                intermediate_steps.append((action, observation))
                logger.info(f"Step {len(intermediate_steps)}:")
                logger.info(f"  Tool: {action.tool}")
                logger.info(f"  Input: {action.tool_input}")
                logger.info(f"  Log: {action.log[:100]}..." if len(action.log) > 100 else f"  Log: {action.log}")
                logger.info(f"  Observation: {str(observation)[:100]}...")
            elif isinstance(chunk, str):
                final_result = chunk
                logger.info(f"\nFinal result: {chunk}")

        logger.info(f"\nTotal chunks: {len(chunks)}")
        logger.info(f"Intermediate steps: {len(intermediate_steps)}")
        logger.info(f"Tools used: {agent.tools_used_names}")
        logger.info("=" * 80 + "\n")

        # Assert we got chunks
        assert len(chunks) > 0, "Should yield at least one chunk"

        # Assert we got intermediate steps (tool calls)
        assert len(intermediate_steps) > 0, "Should have at least one intermediate step"

        # Assert intermediate steps have correct structure
        for action, observation in intermediate_steps:
            assert isinstance(action, AgentAction), "Action should be an AgentAction"
            assert hasattr(action, "tool"), "Action should have tool attribute"
            assert hasattr(action, "tool_input"), "Action should have tool_input attribute"
            assert hasattr(action, "log"), "Action should have log attribute"
            assert observation is not None, "Observation should not be None"

        # Assert final result is a string with expected content
        assert final_result is not None, "Should have a final result"
        assert isinstance(final_result, str), "Final result should be a string"
        assert "30" in final_result, "Final result should contain the answer (30)"

        # Assert tools were used
        assert len(agent.tools_used_names) > 0, "Should have used at least one tool"
        assert "add" in agent.tools_used_names, "Should have used the 'add' tool"

    finally:
        await agent.close()
