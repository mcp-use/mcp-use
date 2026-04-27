"""

End-to-end integration test for agent structured output.

Tests the agent returning structured output using Pydantic models.
"""

import sys
from pathlib import Path

import pytest
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

from mcp_use import MCPAgent, MCPClient
from mcp_use.logging import logger


@pytest.mark.asyncio
@pytest.mark.integration
async def test_agent_structured_output():
    """Test agent returning structured output using Pydantic models."""
    server_path = Path(__file__).parent.parent / "servers_for_testing" / "config_server.py"

    config = {"mcpServers": {"simple": {"command": sys.executable, "args": [str(server_path), "--transport", "stdio"]}}}

    client = MCPClient.from_dict(config)
    llm = ChatOpenAI(model="gpt-4o")
    agent = MCPAgent(llm=llm, client=client, max_steps=5)

    try:
        query = "call the config tool and get the values in config"
        logger.info("\n" + "=" * 80)
        logger.info("TEST: test_agent_structured_output")
        logger.info("=" * 80)
        logger.info(f"Query: {query}")
        metadata = {}
        metadata["a"] = 1
        metadata["b"] = 2
        agent.metadata = metadata

        result = await agent.run(query)

        logger.info("\nStructured result:")
        logger.info(f"  result: {result}")
        logger.info(f"Tools used: {agent.tools_used_names}")
        logger.info(f" tools return value is {result}")

        assert "3" in result
        assert "check_config" in agent.tools_used_names

    finally:
        await agent.close()
