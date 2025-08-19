"""
Direct tool calling example using MCPClient.

Notes:
- This demonstrates calling tools directly without an LLM/agent.
- This approach will not work for tools that require sampling.
"""

import asyncio

from mcp_use import MCPClient

config = {
    "mcpServers": {
        "everything": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-everything"],
        }
    }
}


async def call_tool_example() -> None:
    client = MCPClient.from_dict(config)

    try:
        # Create and initialize sessions for configured servers
        await client.create_all_sessions()

        # Retrieve the session for the "everything" server (match the server name key in the config)
        session = client.get_session("everything")

        # List available tools
        tools = await session.list_tools()
        tool_names = [t.name for t in tools]
        print(f"Available tools: {tool_names}")

        # Choose a tool to call (note: do not call sampling tools because they require an LLM to complete)
        # In the example, we call the "add" tool from the "everything" server
        # Result is a CallToolResult object
        # - content is a list of ContentBlock objects
        # - structuredContent is a dictionary of the structured result of the tool call (only for non-sampling tools)
        # - isError is a boolean indicating if the tool call was successful
        result_tool_add = await session.call_tool(name="add", arguments={"a": 1, "b": 2})

        # Handle and print the result
        if getattr(result_tool_add, "isError", False):
            print(f"Error: {result_tool_add.content}")
        else:
            print(f"Tool result: {result_tool_add.content}")
            print(f"Text result: {result_tool_add.content[0].text}")

    finally:
        # Ensure we clean up resources properly
        await client.close_all_sessions()


if __name__ == "__main__":
    asyncio.run(call_tool_example())
