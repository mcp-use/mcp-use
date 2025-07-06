"""
Basic usage example for streaming with mcp_use.

This example demonstrates how to use the mcp_use library with MCPClient
to connect any LLM to MCP tools through a unified interface.

Special thanks to https://github.com/microsoft/playwright-mcp for the server.
"""

import asyncio
import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient


async def main():
    """Run the example using a configuration file."""
    # Load environment variables
    load_dotenv()
    # Create MCPClient from config file
    client = MCPClient.from_config_file(os.path.join(os.path.dirname(__file__), "browser_mcp.json"))
    # Create LLM
    llm = ChatOpenAI(model="gpt-4o")
    # Create agent with the client
    agent = MCPAgent(llm=llm, client=client, max_steps=30)
    # Run the query
    async for step in agent.stream(
        """
        Navigate to https://github.com/mcp-use/mcp-use, give a star to the project and write
        a summary of the project.
        """,
        max_steps=30,
    ):
        if isinstance(step, str):
            print("Result:", step)
        else:
            action, observation = step
            print("Observation:", observation[:20])
            print("Calling:", action.tool)
            print("Input:", action.tool_input)


if __name__ == "__main__":
    # Run the appropriate example
    asyncio.run(main())
