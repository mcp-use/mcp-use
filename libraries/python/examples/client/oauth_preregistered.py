"""
Test OAuth with Pre-registered credentials using GitHub.

SETUP REQUIRED:
1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Fill in:
   - Application name: mcp-use-test
   - Homepage URL: http://localhost
   - Authorization callback URL: http://127.0.0.1:8080/callback
4. Click "Register application"
5. Copy the Client ID
6. Click "Generate a new client secret" and copy it
7. Create a .env file with:
   GITHUB_CLIENT_ID=your_client_id
   GITHUB_CLIENT_SECRET=your_client_secret
"""

import asyncio
import os

from dotenv import load_dotenv

from mcp_use import MCPClient

load_dotenv()

client_id = os.getenv("GITHUB_CLIENT_ID")
client_secret = os.getenv("GITHUB_CLIENT_SECRET")

if not client_id or not client_secret:
    print("Missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET in .env file")
    print("See docstring at top of file for setup instructions")
    exit(1)

config = {
    "mcpServers": {
        "github": {
            "url": "https://api.githubcopilot.com/mcp",
            "auth": {
                "client_id": client_id,
                "client_secret": client_secret,
                "scope": "read:user",
                "callback_port": 8080,
            },
        }
    }
}


async def main():
    client = MCPClient(config=config)

    try:
        session = await client.create_session("github")
        print("Connected to GitHub MCP server!")

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
