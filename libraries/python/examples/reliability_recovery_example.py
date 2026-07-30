"""
Reliability & Recovery Example: Multi-Server Mutation Recovery

Demonstrates safe recovery from ambiguous MCP tool failures where:
- The destination server commits a mutation.
- The client receives an ambiguous result.
- A naive retry creates a duplicate.
- A guarded workflow verifies state before retrying.

Issue #2054
"""

import asyncio
import sys
from pathlib import Path

from mcp_use import MCPClient

SERVER_SCRIPT = Path(__file__).parent / "synthetic_destination_server.py"


async def run_unguarded_workflow(session):
    """
    Unsafe retry workflow.
    Demonstrates duplicate mutation.
    """
    op_marker = "op_unguarded_101"

    print("\n--- 1. UNGUARDED WORKFLOW (Naive Retry) ---")

    result = await session.call_tool(
        name="create_item",
        arguments={
            "operation_marker": op_marker,
            "item_name": "Widget A",
            "simulate_network_drop": True,
        },
    )

    if not result.isError and result.content[0].text == "AMBIGUOUS_SUCCESS":
        print("[Unguarded] Ambiguous result received.")
    elif result.isError:
        print(f"[Unguarded] Tool call failed: {result.content[0].text}")

    print(f"[Unguarded] Retrying create_item(marker='{op_marker}')...")

    await session.call_tool(
        name="create_item",
        arguments={
            "operation_marker": op_marker,
            "item_name": "Widget A",
            "simulate_network_drop": False,
        },
    )

    print("[Unguarded] Naive retry finished.")


async def run_guarded_workflow(session):
    """
    Safe recovery workflow.
    Verifies external state before retrying.
    """
    op_marker = "op_guarded_202"

    print("\n--- 2. GUARDED WORKFLOW (Read-Back Verification) ---")
    print(f"[Guarded] Calling create_item(marker='{op_marker}')...")

    result = await session.call_tool(
        name="create_item",
        arguments={
            "operation_marker": op_marker,
            "item_name": "Widget B",
            "simulate_network_drop": True,
        },
    )

    if result.isError:
        status = "TOOL_ERROR"
        print(f"[Guarded] create_item failed: {result.content[0].text}")
    elif result.content[0].text == "AMBIGUOUS_SUCCESS":
        status = "EXTERNAL_RESULT_UNCERTAIN"
    else:
        status = "SUCCESS"

    if status == "EXTERNAL_RESULT_UNCERTAIN":
        print(f"[Guarded] Checking read_back for marker '{op_marker}'...")

        result = await session.call_tool(
            name="read_back",
            arguments={
                "operation_marker": op_marker,
            },
        )

        if result.isError:
            print(f"[Guarded] read_back failed: {result.content[0].text}")
            print("[Guarded] Cannot confirm state. Not retrying automatically.")
            return

        recovered_item = result.content[0].text

        if recovered_item and recovered_item != "None":
            print(f"[Guarded] SUCCESS: Found committed item: {recovered_item}")
            print("[Guarded] Skipping retry. Duplicate mutation prevented!")
        else:
            print("[Guarded] Item not found. Safe retry.")
            await session.call_tool(
                name="create_item",
                arguments={
                    "operation_marker": op_marker,
                    "item_name": "Widget B",
                    "simulate_network_drop": False,
                },
            )


async def main():
    print("=" * 58)
    print("  MCP Multi-Server Mutation Recovery Example (#2054)")
    print("=" * 58)

    config = {
        "mcpServers": {
            "destination": {
                "command": sys.executable,
                "args": [str(SERVER_SCRIPT)],
            }
        }
    }

    client = MCPClient.from_dict(config)

    try:
        await client.create_all_sessions()
        session = client.get_session("destination")

        await run_unguarded_workflow(session)
        await run_guarded_workflow(session)
    finally:
        await client.close_all_sessions()


if __name__ == "__main__":
    asyncio.run(main())
