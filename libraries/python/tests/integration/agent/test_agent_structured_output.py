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
    server_path = Path(__file__).parent.parent / "servers_for_testing" / "simple_server.py"

    config = {"mcpServers": {"simple": {"command": sys.executable, "args": [str(server_path), "--transport", "stdio"]}}}

    class CalculationResult(BaseModel):
        """Result of a calculation."""

        first_number: int
        second_number: int
        result: int
        operation: str

    client = MCPClient.from_dict(config)
    llm = ChatOpenAI(model="gpt-4o")
    agent = MCPAgent(llm=llm, client=client, max_steps=5)

    try:
        query = "Add 15 and 25 using the add tool"
        logger.info("\n" + "=" * 80)
        logger.info("TEST: test_agent_structured_output")
        logger.info("=" * 80)
        logger.info(f"Query: {query}")
        logger.info(f"Output schema: {CalculationResult.__name__}")

        result = await agent.run(query, output_schema=CalculationResult)

        logger.info("\nStructured result:")
        logger.info(f"  first_number: {result.first_number}")
        logger.info(f"  second_number: {result.second_number}")
        logger.info(f"  result: {result.result}")
        logger.info(f"  operation: {result.operation}")
        logger.info(f"Tools used: {agent.tools_used_names}")
        logger.info("=" * 80 + "\n")

        assert isinstance(result, CalculationResult)
        assert result.result == 40
        assert result.first_number == 15
        assert result.second_number == 25
        assert "add" in agent.tools_used_names

    finally:
        await agent.close()
