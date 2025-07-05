"""
Example of using client-level authentication with MCPClient.

This example demonstrates how to configure authentication at the client level,
which applies to all MCP servers. Server configurations remain clean and
follow the MCP standard without any authentication details.
"""

import asyncio

from mcp_use import MCPClient


async def main():
    # Example 1: Bearer token authentication at client level
    # This token will be used for all servers that don't have their own auth config
    client_with_bearer = MCPClient(
        config={
            "mcpServers": {
                "server1": {"url": "https://api.example.com/mcp/sse"},
                "server2": {"url": "https://api.another.com/mcp/sse"},
            }
        },
        auth="sk-your-api-key-here",  # Bearer token for all servers
    )

    # Example 2: OAuth authentication at client level
    # This OAuth config will be used for all servers that support OAuth
    MCPClient(
        config={
            "mcpServers": {
                "server1": {"url": "https://oauth.example.com/mcp/sse"},
                "server2": {"url": "https://oauth.another.com/mcp/sse"},
            }
        },
        auth={"client_id": "your-client-id", "client_secret": "your-client-secret", "scope": "read write"},
    )

    # Example 3: Dynamic Client Registration (empty OAuth config)
    # The client will automatically register with the OAuth provider
    MCPClient(
        config={"mcpServers": {"server1": {"url": "https://dcr.example.com/mcp/sse"}}},
        auth={},  # Empty dict triggers Dynamic Client Registration
    )

    # Example 4: Loading from config file with client auth
    MCPClient.from_config_file("config.json", auth="sk-your-api-key")

    # Create sessions - authentication happens automatically
    try:
        # For bearer token example
        session1 = await client_with_bearer.create_session("server1")
        print("Connected to server1 with client-level bearer auth")

        # List available tools (authenticated request)
        tools = await session1.list_tools()
        print(f"Available tools: {[t.name for t in tools]}")

        # Close session
        await session1.disconnect()

    except Exception as e:
        print(f"Error: {e}")

    # Clean up
    await client_with_bearer.close_all_sessions()


if __name__ == "__main__":
    asyncio.run(main())
