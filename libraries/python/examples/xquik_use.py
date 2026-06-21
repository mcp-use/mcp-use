"""
Xquik MCP server example for mcp_use.

This example connects an agent to the hosted Xquik MCP server for X search
and automation workflows. Set XQUIK_API_KEY in your environment before running.
"""

import asyncio
import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient


async def main():
    """Run the Xquik MCP example."""
    load_dotenv()

    xquik_api_key = os.getenv("XQUIK_API_KEY")
    if not xquik_api_key:
        raise RuntimeError("Set XQUIK_API_KEY before running this example.")

    config = {
        "mcpServers": {
            "xquik": {
                "url": "https://xquik.com/mcp",
                "auth": xquik_api_key,
            }
        }
    }

    client = MCPClient.from_dict(config)
    llm = ChatOpenAI(model="gpt-5")
    agent = MCPAgent(llm=llm, client=client, max_steps=10, pretty_print=True)

    try:
        result = await agent.run(
            "Search X for recent posts about MCP adoption and summarize the main themes.",
            max_steps=10,
        )
        print(f"\nResult: {result}")
    finally:
        await client.close_all_sessions()


if __name__ == "__main__":
    asyncio.run(main())
