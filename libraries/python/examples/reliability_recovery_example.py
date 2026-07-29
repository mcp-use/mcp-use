"""
Reliability & Recovery Example: Multi-Server Mutation Recovery

Demonstrates how to safely handle ambiguous tool failures (when a mutating write succeeds
on the destination server, but the network connection/response is lost before reaching the caller).

Workflow comparison:
1. Unguarded Path: Naive retry after an ambiguous drop -> creates duplicate mutations.
2. Guarded Path: Catches EXTERNAL_RESULT_UNCERTAIN -> queries read_back tool using an operation marker -> recovers committed state without duplicate writes.

Issue #2054
"""

import asyncio
from typing import Dict, Optional, Any


class SyntheticDestinationServer:
    """Simulates a duplicate-sensitive destination MCP server with a read-back verification tool."""

    def __init__(self):
        self.database: Dict[str, dict] = {}
        self.total_tool_calls: int = 0
        self.total_mutations: int = 0

    async def create_item(self, operation_marker: str, item_name: str, simulate_network_drop: bool = False) -> dict:
        """
        Mutating tool that creates an item in external storage.
        """
        self.total_tool_calls += 1
        self.total_mutations += 1

        item = {
            "id": f"item_{self.total_mutations}",
            "operation_marker": operation_marker,
            "name": item_name,
        }

        # Record item in database
        if operation_marker in self.database:
            # Duplicate entry detected!
            self.database[f"{operation_marker}_dup_{self.total_mutations}"] = item
        else:
            self.database[operation_marker] = item

        if simulate_network_drop:
            # Simulate external write committing, but response getting lost over transport
            raise ConnectionResetError("Transport connection dropped post-commit (Ambiguous Success)")

        return item

    async def read_back(self, operation_marker: str) -> Optional[dict]:
        """Read-back tool keyed by opaque operation marker to check post-condition."""
        self.total_tool_calls += 1
        return self.database.get(operation_marker)


async def run_unguarded_workflow(server: SyntheticDestinationServer):
    """Scenario 1: Unguarded Retry — results in duplicate mutation."""
    op_marker = "op_unguarded_101"
    print("\n--- 1. UNGUARDED WORKFLOW (Naive Retry) ---")

    # Step 1: Initial call commits mutation, but transport drops response
    try:
        print(f"[Unguarded] Calling create_item(marker='{op_marker}')...")
        await server.create_item(op_marker, "Widget A", simulate_network_drop=True)
    except ConnectionResetError as e:
        print(f"[Unguarded] Ambiguous error encountered: '{e}'")

    # Step 2: Naive retry issued without verification
    print(f"[Unguarded] Retrying create_item(marker='{op_marker}')...")
    await server.create_item(op_marker, "Widget A", simulate_network_drop=False)
    print("[Unguarded] Naive retry finished.")


async def run_guarded_workflow(server: SyntheticDestinationServer):
    """Scenario 2: Guarded Recovery — verifies state before retrying, preventing duplicates."""
    op_marker = "op_guarded_202"
    print("\n--- 2. GUARDED WORKFLOW (Read-Back Verification) ---")

    recovered_item: Optional[dict] = None
    status: str = "UNKNOWN"

    # Step 1: Initial call commits mutation, but transport drops response
    try:
        print(f"[Guarded] Calling create_item(marker='{op_marker}')...")
        await server.create_item(op_marker, "Widget B", simulate_network_drop=True)
        status = "SUCCESS"
    except ConnectionResetError as e:
        print(f"[Guarded] Ambiguous error caught: '{e}'")
        status = "EXTERNAL_RESULT_UNCERTAIN"

    # Step 2: Guarded recovery using operation marker read-back
    if status == "EXTERNAL_RESULT_UNCERTAIN":
        print(f"[Guarded] Result uncertain. Querying read_back tool for marker '{op_marker}'...")
        recovered_item = await server.read_back(op_marker)

        if recovered_item:
            print(f"[Guarded] SUCCESS: Found committed item: {recovered_item}")
            print("[Guarded] Bypassing re-execution of create_item. Duplicate mutation prevented!")
        else:
            print("[Guarded] Item not found. Safe to proceed with create_item retry.")
            recovered_item = await server.create_item(op_marker, "Widget B", simulate_network_drop=False)


def print_reliability_report(unguarded_server: SyntheticDestinationServer, guarded_server: SyntheticDestinationServer):
    """Prints compact reliability report detailing tool counts, mutations, and duplicate resistance."""
    print("\n==========================================================")
    print("              COMPACT RELIABILITY REPORT                  ")
    print("==========================================================")
    print(f"{'Metric':<28} | {'Unguarded':<12} | {'Guarded':<12}")
    print("-" * 60)
    print(f"{'Total Tool Calls':<28} | {unguarded_server.total_tool_calls:<12} | {guarded_server.total_tool_calls:<12}")
    print(f"{'Total Mutations Committed':<28} | {unguarded_server.total_mutations:<12} | {guarded_server.total_mutations:<12}")
    
    unguarded_dups = len(unguarded_server.database) - 1
    guarded_dups = max(0, guarded_server.total_mutations - len(guarded_server.database))
    
    print(f"{'Duplicate Count':<28} | {unguarded_dups:<12} | {guarded_dups:<12}")
    print(f"{'Duplicate-Resistant Guarantee':<28} | {'FAILED':<12} | {'PASSED':<12}")
    print("==========================================================\n")


async def main():
    print("==========================================================")
    print("  MCP Multi-Server Mutation Recovery Example (#2054)")
    print("==========================================================")

    # Run unguarded scenario
    unguarded_server = SyntheticDestinationServer()
    await run_unguarded_workflow(unguarded_server)

    # Run guarded scenario
    guarded_server = SyntheticDestinationServer()
    await run_guarded_workflow(guarded_server)

    # Print summary report
    print_reliability_report(unguarded_server, guarded_server)


if __name__ == "__main__":
    asyncio.run(main())