"""
Basic usage example for the Model-Agnostic MCP Library for LLMs.

This example demonstrates how to use the mcp_use library with MCPClient
to connect any LLM to MCP tools through a unified interface.
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
    client = MCPClient.from_config_file(
        os.path.join(os.path.dirname(__file__), "browser_mcp.json")
    )

    # Create LLM
    llm = ChatOpenAI(model="gpt-4o")
    # llm = init_chat_model(model="llama-3.1-8b-instant", model_provider="groq")
    # llm = ChatAnthropic(model="claude-3-")
    # llm = ChatGroq(model="llama3-8b-8192")

    # Create agent with the clientgsk_wBddPYne6amHptyAI4c7WGdyb3FYT9xxEu6JqUujDAlOvuSqGOsL
    agent = MCPAgent(llm=llm, client=client, max_steps=30)

    # Run the query
    result = await agent.run(
        "Find the best restaurant in San Francisco USING GOOGLE SEARCH",
        max_steps=30,
    )
    print(f"\nResult: {result}")


if __name__ == "__main__":
    # Run the appropriate example
    asyncio.run(main())
