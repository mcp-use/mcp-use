"""
Basic usage example for streaming with mcp_use.

This example demonstrates how to use the MCPAgent to navigate to a news site,
extract the main headlines, and summarize them.
"""

import asyncio

from dotenv import load_dotenv
from langchain_anthropic import ChatAnthropic
from mcp_use import MCPAgent, MCPClient


async def main():
    """Run the example using Playwright MCP server."""
    # Load environment variables
    load_dotenv()

    # Configure MCP to use Playwright
    config = {
        "mcpServers": {
            "playwright": {
                "command": "npx",
                "args": ["@playwright/mcp@latest"],
                "env": {"DISPLAY": ":1"},
            }
        }
    }

    # Create MCPClient
    client = MCPClient(config=config)

    # Create LLM
    llm = ChatAnthropic(model="claude-3-5-sonnet-20240620")

    # Create agent with the client
    agent = MCPAgent(llm=llm, client=client, max_steps=25)

    # Example task: scrape headlines
    async for step in agent.stream(
        """
        Navigate to https://www.bbc.com/news,
        extract the top 5 headlines shown on the homepage,
        and provide a short 1-sentence summary of each.
        """,
        max_steps=25,
    ):
        pass


if __name__ == "__main__":
    asyncio.run(main())
    