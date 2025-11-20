"""
Basic usage example for streaming with mcp_use.

This example demonstrates how to use the mcp_use library with MCPClient
to connect any LLM to MCP tools through a unified interface.

Special thanks to https://github.com/microsoft/playwright-mcp for the server.
"""

import asyncio

from dotenv import load_dotenv
from langchain_anthropic import ChatAnthropic

from mcp_use import MCPAgent, MCPClient


async def main():
    """Run the example using a configuration file."""
    # Load environment variables
    load_dotenv()

    config = {
        "mcpServers": {"playwright": {"command": "npx", "args": ["@playwright/mcp@latest"], "env": {"DISPLAY": ":1"}}}
    }
    # Create MCPClient from config file
    client = MCPClient(config=config)
    # Create LLM
    llm = ChatAnthropic(model="claude-sonnet-4-5")
    # Create agent with the client
    agent = MCPAgent(llm=llm, client=client, max_steps=30, pretty_print=True)
    # Run the query
    async for step in agent.stream(
        """
        Can you go on github and tell me how many stars the mcp-use project has?
        """,
        max_steps=30,
    ):
        if isinstance(step, str):
            print("-------------Result--------------------------")
            print("Result:", step)
        else:
            action, observation = step
            print("-------------Log--------------------------")
            print("Log:", action.log)
            print("--------------------------------")
            print("-------------Calling--------------------------")
            print("Calling:", action.tool)
            print("--------------------------------")
            print("-------------Input--------------------------")
            print("Input:", action.tool_input)
            print("--------------------------------")
            print("-------------Observation--------------------------")
            print("Observation:", observation)
            print("--------------------------------")


if __name__ == "__main__":
    # Run the appropriate example
    asyncio.run(main())
