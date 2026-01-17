"""
Test OAuth with Dynamic Client Registration (DCR) using Linear.

Linear supports DCR, so no manual OAuth app setup is required.
Just run this script and it will:
1. Discover OAuth metadata from Linear
2. Dynamically register a client
3. Open your browser to authorize
4. Connect to the MCP server
"""

import asyncio

from mcp_use import MCPClient

config = {
    "mcpServers": {
        "linear": {
            "url": "https://mcp.linear.app/sse"
            # No auth config needed - DCR handles everything
        }
    }
}


async def main():
    client = MCPClient(config=config)

    try:
        session = await client.create_session("linear")
        print("Connected to Linear MCP server!")

        # List available tools
        tools = await session.connector.list_tools()
        print(f"\nAvailable tools ({len(tools)}):")
        for tool in tools[:5]:  # Show first 5
            print(f"  - {tool.name}")
        if len(tools) > 5:
            print(f"  ... and {len(tools) - 5} more")

    finally:
        await client.close_all_sessions()


if __name__ == "__main__":
    asyncio.run(main())
