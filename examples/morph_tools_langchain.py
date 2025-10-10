import asyncio
import os

from dotenv import load_dotenv

from mcp_use import MCPClient
from mcp_use.adapters import LangChainAdapter


async def main():
    load_dotenv()  # Optional: loads from .env file. Otherwise export MORPH_API_KEY in your shell.

    # Build config with actual env var values (JSON doesn't expand ${VAR} syntax)
    config = {
        "mcpServers": {
            "filesystem-with-morph": {
                "command": "npx",
                "args": ["@morph-llm/morph-fast-apply"],
                "env": {
                    "MORPH_API_KEY": os.getenv("MORPH_API_KEY", ""),
                    "ALL_TOOLS": "false",  # Set to "true" to expose all Morph filesystem tools
                },
            }
        }
    }
    client = MCPClient.from_dict(config)

    # Get all tools discovered from Morph
    tools = await LangChainAdapter().create_tools(client)

    print(f"Discovered {len(tools)} tool(s) from Morph MCP:")
    for t in tools:
        print(f"  • {t.name}: {t.description[:80]}...")


if __name__ == "__main__":
    asyncio.run(main())
