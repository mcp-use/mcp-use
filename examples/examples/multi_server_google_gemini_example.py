"""
Example demonstrating how to use MCPClient with multiple servers via Google Gemini 2.5 Pro Model.

This example shows how to:
1. Configure multiple MCP servers
2. Create and manage sessions for each server
3. Use tools from different servers in a single agent
"""

import asyncio

from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
from mcp_use import MCPAgent, MCPClient


async def run_multi_server_example():
    """Run an example using multiple MCP servers."""
    # Load environment variables
    load_dotenv()

    # Create a configuration with multiple servers
    config = {
        "mcpServers": {
            "airbnb": {
                "command": "npx",
                "args": ["-y", "@openbnb/mcp-server-airbnb", "--ignore-robots-txt"],
            },
            "playwright": {
                "command": "npx",
                "args": ["@playwright/mcp@latest"],
                "env": {"DISPLAY": ":1"},
            },
            "filesystem": {
                "command": "npx",
                "args": [
                    "-y",
                    "@modelcontextprotocol/server-filesystem",
                    "~/Documents/",
                ],
            },
        }
    }

    # Create MCPClient with the multi-server configuration
    client = MCPClient.from_dict(config)

    # Create LLM
    llm = ChatGoogleGenerativeAI(
        model="gemini-2.5-flash", model_kwargs={"api_version": "v1"}
    )

    # Create agent with the client
    agent = MCPAgent(llm=llm, client=client, max_steps=30)

    # Example 1: Using tools from different servers in a single query
    result = await agent.run(
        "Search for a nice place to stay in Barcelona on Airbnb, "
        "then use Google to find nearby restaurants and attractions."
        "Write the result in the current directory in restaurant.txt",
        max_steps=30,
    )
    print(result)


if __name__ == "__main__":
    asyncio.run(run_multi_server_example())
