"""
End-to-end integration test for agent.stream().

Tests the agent.stream() method yielding incremental responses.
"""

import sys
from pathlib import Path

import pytest
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
        async for chunk in agent.stream(query):
            chunks.append(chunk)
            logger.info(f"Chunk {len(chunks)}: {chunk}")

        final_result = chunks[-1]
        logger.info(f"\nFinal result: {final_result}")
        logger.info(f"Total chunks: {len(chunks)}")
        logger.info(f"Tools used: {agent.tools_used_names}")
        logger.info("=" * 80 + "\n")

        assert len(chunks) > 0
        assert "30" in str(final_result)
        assert len(agent.tools_used_names) > 0

    finally:
        await agent.close()
