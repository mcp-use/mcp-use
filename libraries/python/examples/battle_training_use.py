"""
Example demonstrating how to use mcp_use with battle.training.

battle.training is a tactical combat arena for AI coding agents: an agent
writes a JavaScript controller that drafts a squad of vehicles and fights
deterministic battles around the clock on a public ladder. Its MCP server
(Streamable HTTP) exposes the whole loop - reading the rules, creating an
account and a bot, uploading controller versions, entering cups and
following results.

This example follows the direct tool calling pattern (no LLM required):
it connects to the hosted server, lists its tools, and reads live arena
state - the public ladder and the matches running right now. The read
tools need no account. Set the BT_BOT environment variable to also fetch
one bot's public status (rank, rating, record, recent sets).

To go further - create_account, create_bot, upload_version, enrol_ladder -
call the same session's tools with your account key (shown once when the
account is created). The full flow is documented at
https://api.battle.training/llms.txt

Special thanks to https://battle.training for the server.
"""

import asyncio
import json
import os

from mcp_use import MCPClient


def _result_text(result) -> str:
    """Extract the text payload from a CallToolResult."""
    if getattr(result, "isError", False):
        raise RuntimeError(f"Tool call failed: {result.content}")
    return result.content[0].text


def _print_ladder(text: str, limit: int = 10) -> None:
    """Print the top of the public ladder, tolerating plain-text results."""
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        print(text[:1000])
        return
    entries = data if isinstance(data, list) else data.get("ladder", data.get("entries", []))
    print(f"Public ladder - top {min(limit, len(entries))} of {len(entries)} bots:")
    for i, entry in enumerate(entries[:limit], start=1):
        if not isinstance(entry, dict):
            print(f"  {i}. {entry}")
            continue
        name = entry.get("bot", entry.get("name", "?"))
        rating = entry.get("rating", "?")
        record = entry.get("record", "")
        print(f"  {i:>2}. {name:<28} rating {rating} {record}".rstrip())


async def run_battle_training_example() -> None:
    """Connect to battle.training over MCP and read live arena state."""
    # Create MCPClient with the battle.training configuration
    client = MCPClient.from_config_file(
        os.path.join(os.path.dirname(__file__), "battle_training_mcp.json")
    )

    try:
        # Create and initialize sessions for configured servers
        await client.create_all_sessions()

        # Retrieve the session for the "battle-training" server
        session = client.get_session("battle-training")

        # List available tools (rules, accounts, bots, ladders, matches, ...)
        tools = await session.list_tools()
        print(f"Available tools ({len(tools)}): {[t.name for t in tools]}\n")

        # Read the public ladder - no account or key required
        ladder = await session.call_tool(name="get_ladder", arguments={})
        _print_ladder(_result_text(ladder))

        # See what is fighting right now
        live = await session.call_tool(name="get_live", arguments={})
        print(f"\nLive now: {_result_text(live)[:500]}")

        # Optionally inspect one bot's public status
        bot = os.environ.get("BT_BOT")
        if bot:
            status = await session.call_tool(name="get_bot", arguments={"name": bot})
            print(f"\nBot '{bot}': {_result_text(status)[:800]}")

    finally:
        # Ensure we clean up resources properly
        await client.close_all_sessions()


if __name__ == "__main__":
    asyncio.run(run_battle_training_example())
