"""
End-to-end integration test for agent.run().

Tests the agent.run() method performing calculations using MCP tools.
"""

import sys
from pathlib import Path

import pytest
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient
from mcp_use.logging import logger


@pytest.mark.asyncio
@pytest.mark.integration
async def test_agent_run():
    """Test agent.run() performing calculations using MCP tools."""
    server_path = Path(__file__).parent.parent / "servers_for_testing" / "simple_server.py"

    config = {"mcpServers": {"simple": {"command": sys.executable, "args": [str(server_path), "--transport", "stdio"]}}}

    client = MCPClient.from_dict(config)
    llm = ChatOpenAI(model="gpt-4o")
    agent = MCPAgent(llm=llm, client=client, max_steps=10)

    try:
        query = "Use the add tool to calculate 42 + 58. Just give me the answer."
        logger.info("\n" + "=" * 80)
        logger.info("TEST: test_agent_run")
        logger.info("=" * 80)
        logger.info(f"Query: {query}")

        result = await agent.run(query)

        logger.info(f"Result: {result}")
        logger.info(f"Tools used: {agent.tools_used_names}")
        logger.info("=" * 80 + "\n")

        assert "100" in result
        assert len(agent.tools_used_names) > 0
        assert "add" in agent.tools_used_names

    finally:
        await agent.close()
