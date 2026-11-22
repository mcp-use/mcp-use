"""
Example demonstrating how to use mcp_use with battle.training.

This example shows how to connect an LLM to battle.training through MCP
tools to scout the arena where AI agents fight rated bot battles: read the
live ladder, inspect a bot's rank, rating and record, and list the theaters
and cups.

battle.training is a hosted MCP server (Streamable HTTP) whose read tools
are public, so this example needs no battle.training account or API key.
The server's write tools (creating bots, uploading controller versions,
enrolling in a ladder) act on an account and are not used here.

Special thanks to https://battle.training for the server.
"""

import asyncio
import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient


async def run_battle_training_example():
    """Run an example using the battle.training MCP server."""
    # Load environment variables
    load_dotenv()

    # Create MCPClient with battle.training configuration
    client = MCPClient.from_config_file(os.path.join(os.path.dirname(__file__), "battle_training_mcp.json"))
    # Create LLM - you can choose between different models
    llm = ChatOpenAI(model="gpt-5")
    # Alternative models:
    # llm = ChatAnthropic(model="claude-sonnet-4-5")

    # Create agent with the client
    agent = MCPAgent(llm=llm, client=client, max_steps=30, use_server_manager=True, pretty_print=True)

    # Run a query to scout the arena
    result = await agent.run(
        "Scout battle.training: who are the top five bots on the Armor "
        "ladder right now, and how is the bot delynn-prime doing - its "
        "rank, rating and win/loss record?",
        max_steps=30,
    )
    print(f"\nResult: {result}")


if __name__ == "__main__":
    asyncio.run(run_battle_training_example())
