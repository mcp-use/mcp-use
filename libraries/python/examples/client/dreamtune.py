"""Discover Dreamtune tools or call one explicitly with MCPClient.

See dreamtune.md for setup. No LLM provider key is required.
"""

import argparse
import asyncio
import json
import os

from mcp_use import MCPClient


async def main() -> None:
    """Connect to the published stdio server and discover or invoke its tools."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tool", help="Tool name from the discovery output")
    parser.add_argument("--arguments", default="{}", help="JSON object for --tool")
    options = parser.parse_args()
    key = os.environ.get("DREAMTUNE_API_KEY")
    if not key:
        parser.error("Set DREAMTUNE_API_KEY to your workspace API key")
    try:
        arguments = json.loads(options.arguments)
    except json.JSONDecodeError as error:
        parser.error(str(error))
    if not isinstance(arguments, dict):
        parser.error("--arguments must be a JSON object")

    client = MCPClient(
        config={
            "mcpServers": {
                "dreamtune": {
                    "command": "npx",
                    "args": ["-y", "--package", "@dreamtune/sdk@0.1.2", "dreamtune-mcp"],
                    "env": {
                        "DREAMTUNE_API_KEY": key,
                        "DREAMTUNE_API_ORIGIN": "https://api.dreamtunelabs.com",
                        "DREAMTUNE_REQUEST_TIMEOUT_MS": "60000",
                    },
                }
            }
        }
    )
    try:
        session = await client.create_session("dreamtune")
        tools = await session.list_tools()
        if options.tool:
            if options.tool not in {tool.name for tool in tools}:
                parser.error("Unknown tool; run without --tool to list available names")
            result = await session.call_tool(options.tool, arguments)
            print(result.model_dump_json(indent=2))
            if result.isError:
                raise SystemExit(1)
        else:
            for tool in tools:
                print(f"{tool.name}: {tool.description}")
    finally:
        await client.close_all_sessions()


if __name__ == "__main__":
    asyncio.run(main())
