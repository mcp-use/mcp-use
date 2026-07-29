"""
Reliability & Recovery Example: Multi-Server Mutation Recovery

Demonstrates how to safely handle ambiguous tool failures:
- Destination server commits a mutation
- Response is lost
- Client does NOT blindly retry
- Client verifies using read-back before retrying

Issue #2054
"""

import asyncio
from typing import Any, Dict, Optional

from mcp_use import MCPClient


class SyntheticDestinationServer:
    """
    Synthetic destination MCP server.

    Simulates an external system with:
    - create_item mutation tool
    - read_back verification tool
    """

    def __init__(self):
        self.database: dict[str, dict] = {}
        self.total_tool_calls = 0
        self.total_mutations = 0

    async def create_item(
        self,
        operation_marker: str,
        item_name: str,
        simulate_network_drop: bool = False,
    ) -> dict:

        self.total_tool_calls += 1
        self.total_mutations += 1

        item = {
            "id": f"item_{self.total_mutations}",
            "operation_marker": operation_marker,
            "name": item_name,
        }

        if operation_marker in self.database:
            self.database[
                f"{operation_marker}_duplicate_{self.total_mutations}"
            ] = item
        else:
            self.database[operation_marker] = item

        if simulate_network_drop:
            raise ConnectionResetError(
                "Transport connection dropped post-commit "
                "(Ambiguous Success)"
            )

        return item

    async def read_back(
        self,
        operation_marker: str
    ) -> dict | None:

        self.total_tool_calls += 1

        return self.database.get(operation_marker)


class LocalMCPToolClient:
    """
    Small adapter representing MCPClient tool calls.

    The example keeps the fixture local and deterministic while exposing
    MCP-style call_tool behaviour.
    """

    def __init__(self, server: SyntheticDestinationServer):
        self.server = server

    async def call_tool(
        self,
        tool_name: str,
        arguments: dict,
    ) -> Any:

        if tool_name == "create_item":

            return await self.server.create_item(
                arguments["operation_marker"],
                arguments["item_name"],
                arguments.get(
                    "simulate_network_drop",
                    False,
                ),
            )

        if tool_name == "read_back":

            return await self.server.read_back(
                arguments["operation_marker"]
            )

        raise ValueError(
            f"Unknown tool: {tool_name}"
        )


async def run_unguarded_workflow(client: LocalMCPToolClient):

    marker = "op_unguarded_101"

    print(
        "\n--- 1. UNGUARDED WORKFLOW "
        "(Naive Retry) ---"
    )

    try:
        await client.call_tool(
            "create_item",
            {
                "operation_marker": marker,
                "item_name": "Widget A",
                "simulate_network_drop": True,
            },
        )

    except ConnectionResetError as error:

        print(
            f"[Unguarded] Error: {error}"
        )

    await client.call_tool(
        "create_item",
        {
            "operation_marker": marker,
            "item_name": "Widget A",
            "simulate_network_drop": False,
        },
    )

    print(
        "[Unguarded] Retry completed"
    )


async def run_guarded_workflow(client: LocalMCPToolClient):

    marker = "op_guarded_202"

    print(
        "\n--- 2. GUARDED WORKFLOW "
        "(Read-Back Verification) ---"
    )

    status = "UNKNOWN"

    try:

        await client.call_tool(
            "create_item",
            {
                "operation_marker": marker,
                "item_name": "Widget B",
                "simulate_network_drop": True,
            },
        )

        status = "SUCCESS"

    except ConnectionResetError as error:

        print(
            f"[Guarded] Error: {error}"
        )

        status = "EXTERNAL_RESULT_UNCERTAIN"

    if status == "EXTERNAL_RESULT_UNCERTAIN":

        print(
            "[Guarded] Checking read_back..."
        )

        item = await client.call_tool(
            "read_back",
            {
                "operation_marker": marker
            },
        )

        if item:

            print(
                f"[Guarded] Found committed item: {item}"
            )

            print(
                "[Guarded] Duplicate mutation prevented"
            )

        else:

            print(
                "[Guarded] Item missing. "
                "Safe retry."
            )

            await client.call_tool(
                "create_item",
                {
                    "operation_marker": marker,
                    "item_name": "Widget B",
                },
            )


def print_reliability_report(
    unguarded_server,
    guarded_server,
):

    print(
        "\n=========================================================="
    )

    print(
        "              COMPACT RELIABILITY REPORT"
    )

    print(
        "=========================================================="
    )

    print(
        "NOTE: This demonstrates duplicate-resistant recovery, "
        "not exactly-once execution."
    )


async def main():

    print(
        "=========================================================="
    )

    print(
        " MCP Multi-Server Mutation Recovery Example (#2054)"
    )

    print(
        "=========================================================="
    )

    config = {
        "mcpServers": {}
    }

    MCPClient.from_dict(config)

    unguarded_server = SyntheticDestinationServer()

    unguarded_client = LocalMCPToolClient(
        unguarded_server
    )

    await run_unguarded_workflow(
        unguarded_client
    )

    guarded_server = SyntheticDestinationServer()

    guarded_client = LocalMCPToolClient(
        guarded_server
    )

    await run_guarded_workflow(
        guarded_client
    )

    print_reliability_report(
        unguarded_server,
        guarded_server,
    )


if __name__ == "__main__":
    asyncio.run(main())