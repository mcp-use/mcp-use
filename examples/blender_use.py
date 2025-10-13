"""
Blender MCP example for mcp_use.

This example demonstrates how to use the mcp_use library with MCPClient
to connect an LLM to Blender through MCP tools via WebSocket.
The example assumes you have installed the Blender MCP addon from:
https://github.com/ahujasid/blender-mcp

Make sure the addon is enabled in Blender preferences and the WebSocket
server is running before executing this script.

Special thanks to https://github.com/ahujasid/blender-mcp for the server.
"""

import asyncio

from dotenv import load_dotenv
from langchain_anthropic import ChatAnthropic

from mcp_use import MCPAgent, MCPClient


async def run_blender_example():
    """Run the Blender MCP example."""
    # Load environment variables
    load_dotenv()

    # Create MCPClient with Blender MCP configuration
    config = {"mcpServers": {"blender": {"command": "uvx", "args": ["blender-mcp"]}}}
    client = MCPClient.from_dict(config)

    # Create LLM
    llm = ChatAnthropic(model="claude-3-5-sonnet-20240620")

    # Create agent with the client
    agent = MCPAgent(llm=llm, client=client, max_steps=30)

    try:
        # Run the query
        result = await agent.run(
            "Create an inflatable cube with soft material and a plane as ground.",
            max_steps=30,
        )
        print(f"\nResult: {result}")
    finally:
        # Ensure we clean up resources properly
        if client.sessions:
            await client.close_all_sessions()


if __name__ == "__main__":
    # Run the Blender example
    asyncio.run(run_blender_example())
