"""
End-to-end integration test for server manager.

Tests the agent with custom server manager for dynamic tool management.
"""

import sys
from pathlib import Path

import pytest
from langchain_core.tools import BaseTool
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient
from mcp_use.agents.managers.base import BaseServerManager
from mcp_use.logging import logger


@pytest.mark.asyncio
@pytest.mark.integration
async def test_server_manager():
    """Test agent with custom server manager for dynamic tool management."""
    server_path = Path(__file__).parent.parent / "servers_for_testing" / "simple_server.py"

    config = {"mcpServers": {"simple": {"command": sys.executable, "args": [str(server_path), "--transport", "stdio"]}}}

    class GreetingTool(BaseTool):
        """A simple greeting tool."""

        name: str = "greet"
        description: str = "Returns a greeting message"

        def _run(self, name: str = "World") -> str:
            return f"Hello, {name}!"

        async def _arun(self, name: str = "World") -> str:
            return f"Hello, {name}!"

    class CustomServerManager(BaseServerManager):
        """Custom server manager with dynamic tool addition."""

        def __init__(self):
            self._tools: list[BaseTool] = []
            self._initialized = False

        def add_tool(self, tool: BaseTool):
            self._tools.append(tool)

        async def initialize(self) -> None:
            # Create the get_greeting_tool dynamically inside the manager
            class GetGreetingToolTool(BaseTool):
                """A tool that adds a greeting tool to the server manager."""

                name: str = "get_greeting_tool"
                description: str = "Adds a greeting tool to the server manager"
                manager: CustomServerManager

                def _run(self) -> str:
                    greeting_tool = GreetingTool()
                    self.manager.add_tool(greeting_tool)
                    return f"Added greeting tool to server manager. Total tools: {len(self.manager.tools)}"

                async def _arun(self) -> str:
                    greeting_tool = GreetingTool()
                    self.manager.add_tool(greeting_tool)
                    return f"Added greeting tool to server manager. Total tools: {len(self.manager.tools)}"

            get_greeting_tool = GetGreetingToolTool(manager=self)
            self.add_tool(get_greeting_tool)
            self._initialized = True

        @property
        def tools(self) -> list[BaseTool]:
            return list(self._tools)

        def has_tool_changes(self, current_tool_names: set[str]) -> bool:
            new_tool_names = {tool.name for tool in self.tools}
            return new_tool_names != current_tool_names

    client = MCPClient.from_dict(config)
    llm = ChatOpenAI(model="gpt-4o")
    server_manager = CustomServerManager()

    agent = MCPAgent(llm=llm, client=client, use_server_manager=True, server_manager=server_manager, max_steps=10)

    try:
        logger.info("\n" + "=" * 80)
        logger.info("TEST: test_server_manager")
        logger.info("=" * 80)

        await agent.initialize()

        logger.info(f"Initial server manager tools: {[t.name for t in server_manager.tools]}")

        assert len(server_manager.tools) == 1
        assert server_manager.tools[0].name == "get_greeting_tool"

        query = "Call get_greeting_tool to add the greeting tool, then use the greet tool to say hello to Alice"
        logger.info(f"Query: {query}")

        result = await agent.run(query)

        logger.info(f"Result: {result}")
        logger.info(f"Tools used: {agent.tools_used_names}")
        logger.info(f"Final server manager tools: {[t.name for t in server_manager.tools]}")
        logger.info("=" * 80 + "\n")

        # Assert the agent used the get_greeting_tool to add the greeting tool
        assert "get_greeting_tool" in agent.tools_used_names
        # Assert the server manager has at least 2 tools
        assert len(server_manager.tools) >= 2
        # Assert the server manager has the greet tool
        assert "greet" in [t.name for t in server_manager.tools]
        # Assert the gree tool was used by the agent
        assert "greet" in agent.tools_used_names

    finally:
        await agent.close()
