"""
Synthetic MCP destination server for reliability recovery example.

Provides:
- create_item mutation tool
- read_back verification tool

Demonstrates ambiguous success recovery.
"""

import asyncio

from mcp import types
from mcp.server import Server
from mcp.server.stdio import stdio_server

database: dict[str, dict] = {}
total_mutations = 0


server = Server("synthetic_destination")


@server.list_tools()
async def list_tools():

    return [
        types.Tool(
            name="create_item",
            description="Create an item using an operation marker",
            inputSchema={
                "type": "object",
                "properties": {
                    "operation_marker": {"type": "string"},
                    "item_name": {"type": "string"},
                    "simulate_network_drop": {"type": "boolean"},
                },
                "required": [
                    "operation_marker",
                    "item_name",
                ],
            },
        ),
        types.Tool(
            name="read_back",
            description="Read an item using operation marker",
            inputSchema={
                "type": "object",
                "properties": {
                    "operation_marker": {"type": "string"},
                },
                "required": [
                    "operation_marker",
                ],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name, arguments):

    global total_mutations

    if name == "create_item":
        total_mutations += 1

        item = {
            "id": f"item_{total_mutations}",
            "operation_marker": arguments["operation_marker"],
            "name": arguments["item_name"],
        }

        # Commit mutation first
        database[arguments["operation_marker"]] = item

        # Simulate ambiguous success:
        # Mutation succeeds, but client receives an error response.
        if arguments.get("simulate_network_drop", False):
            return [
                types.TextContent(
                    type="text",
                    text="AMBIGUOUS_SUCCESS",
                )
            ]

        return [
            types.TextContent(
                type="text",
                text=str(item),
            )
        ]

    if name == "read_back":
        item = database.get(arguments["operation_marker"])

        return [
            types.TextContent(
                type="text",
                text=str(item),
            )
        ]

    raise ValueError(f"Unknown tool {name}")


async def main():

    async with stdio_server() as streams:
        await server.run(
            streams[0],
            streams[1],
            server.create_initialization_options(),
        )


if __name__ == "__main__":
    asyncio.run(main())
