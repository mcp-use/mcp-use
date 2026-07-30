"""
Reliability & Recovery Example: Multi-Server Mutation Recovery

Demonstrates how to safely handle ambiguous tool failures where a mutation
succeeds on the destination server but the response is lost due to network
failure.

Workflow comparison:
1. Unguarded Path:
   Retry immediately after ambiguous failure -> duplicate mutation.

2. Guarded Path:
   Verify external state using operation marker -> recover without duplicate.

Issue #2054
"""

import asyncio


class SyntheticDestinationServer:
    """
    Simulates a duplicate-sensitive destination MCP server.
    """

    def __init__(self):
        self.database: dict[str, dict] = {}
        self.total_tool_calls: int = 0
        self.total_mutations: int = 0


    async def create_item(
        self,
        operation_marker: str,
        item_name: str,
        simulate_network_drop: bool = False,
    ) -> dict:
        """
        Mutating tool that creates an item.
        """

        self.total_tool_calls += 1
        self.total_mutations += 1

        item = {
            "id": f"item_{self.total_mutations}",
            "operation_marker": operation_marker,
            "name": item_name,
        }


        # Store mutation result
        if operation_marker in self.database:

            # Duplicate mutation created
            self.database[
                f"{operation_marker}_dup_{self.total_mutations}"
            ] = item

        else:

            self.database[operation_marker] = item


        if simulate_network_drop:

            raise ConnectionResetError(
                "Transport connection dropped post-commit (Ambiguous Success)"
            )


        return item



    async def read_back(
        self,
        operation_marker: str,
    ) -> dict | None:
        """
        Checks whether mutation already happened.
        """

        self.total_tool_calls += 1

        return self.database.get(operation_marker)



async def run_unguarded_workflow(
    server: SyntheticDestinationServer,
):
    """
    Unguarded retry workflow.
    Creates duplicate mutation.
    """

    op_marker = "op_unguarded_101"


    print(
        "\n--- 1. UNGUARDED WORKFLOW (Naive Retry) ---"
    )


    try:

        print(
            f"[Unguarded] Calling create_item(marker='{op_marker}')..."
        )


        await server.create_item(
            op_marker,
            "Widget A",
            simulate_network_drop=True,
        )


    except ConnectionResetError as e:

        print(
            f"[Unguarded] Ambiguous error encountered: {e}"
        )


    # Unsafe retry
    print(
        f"[Unguarded] Retrying create_item(marker='{op_marker}')..."
    )


    await server.create_item(
        op_marker,
        "Widget A",
        simulate_network_drop=False,
    )


    print(
        "[Unguarded] Naive retry finished."
    )



async def run_guarded_workflow(
    server: SyntheticDestinationServer,
):
    """
    Guarded recovery workflow.
    Prevents duplicate mutation.
    """

    op_marker = "op_guarded_202"


    print(
        "\n--- 2. GUARDED WORKFLOW (Read-Back Verification) ---"
    )


    status = "UNKNOWN"


    try:

        print(
            f"[Guarded] Calling create_item(marker='{op_marker}')..."
        )


        await server.create_item(
            op_marker,
            "Widget B",
            simulate_network_drop=True,
        )


        status = "SUCCESS"


    except ConnectionResetError as e:

        print(
            f"[Guarded] Ambiguous error caught: {e}"
        )


        status = "EXTERNAL_RESULT_UNCERTAIN"



    if status == "EXTERNAL_RESULT_UNCERTAIN":


        print(
            f"[Guarded] Checking read_back for marker '{op_marker}'..."
        )


        recovered_item = await server.read_back(
            op_marker
        )


        if recovered_item:


            print(
                f"[Guarded] SUCCESS: Found committed item: {recovered_item}"
            )


            print(
                "[Guarded] Skipping retry. Duplicate mutation prevented!"
            )


        else:


            print(
                "[Guarded] Item not found. Safe retry."
            )


            await server.create_item(
                op_marker,
                "Widget B",
                simulate_network_drop=False,
            )



def print_reliability_report(
    unguarded_server: SyntheticDestinationServer,
    guarded_server: SyntheticDestinationServer,
):
    """
    Prints reliability comparison report.
    """


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
        f"{'Metric':<35} | "
        f"{'Unguarded':<12} | "
        f"{'Guarded':<12}"
    )


    print("-" * 65)



    unguarded_duplicates = (
        len(unguarded_server.database) - 1
    )


    guarded_duplicates = max(
        0,
        guarded_server.total_mutations
        - len(guarded_server.database),
    )



    print(
        f"{'Total Tool Calls':<35} | "
        f"{unguarded_server.total_tool_calls:<12} | "
        f"{guarded_server.total_tool_calls:<12}"
    )


    print(
        f"{'Total Mutations Committed':<35} | "
        f"{unguarded_server.total_mutations:<12} | "
        f"{guarded_server.total_mutations:<12}"
    )


    print(
        f"{'Duplicate Count':<35} | "
        f"{unguarded_duplicates:<12} | "
        f"{guarded_duplicates:<12}"
    )


    print(
        f"{'Recovery Verification':<35} | "
        f"{'FAILED':<12} | "
        f"{'SUCCESS':<12}"
    )


    print(
        "=========================================================="
    )


    print(
        "NOTE: Demonstrates duplicate-resistant recovery, "
        "not exactly-once execution."
    )



async def main():

    print(
        "=========================================================="
    )

    print(
        "  MCP Multi-Server Mutation Recovery Example (#2054)"
    )

    print(
        "=========================================================="
    )



    # Unguarded test

    unguarded_server = SyntheticDestinationServer()


    await run_unguarded_workflow(
        unguarded_server
    )



    # Guarded test

    guarded_server = SyntheticDestinationServer()


    await run_guarded_workflow(
        guarded_server
    )



    # Report

    print_reliability_report(
        unguarded_server,
        guarded_server,
    )



if __name__ == "__main__":

    asyncio.run(main())
