"""
Remote docs search and read example for mcp-use.

Install:
    pip install mcp-use

Run:
    python examples/remote_docs.py

Connects to a hosted MCP server and searches and reads its public documentation.
No local server, BlockVectra account, API key, or model configuration is needed.
A network connection is required.
"""

import asyncio

from mcp.types import CallToolResult, TextContent

from mcp_use import MCPClient

config = {
    "mcpServers": {
        "blockvectra-docs-only": {
            "url": "https://docs.blockvectra.com/mcp/docs",
            "auth": None,  # Skip OAuth discovery for this public endpoint.
            "timeout": 15,
            "sse_read_timeout": 15,
            "headers": {
                "User-Agent": "mcp-use-remote-docs-example/1 BlockVectraQA/1",
            },
        }
    }
}


def result_text(result: CallToolResult) -> str:
    """Return the text content of a successful tool result."""
    if result.isError:
        raise RuntimeError(f"Tool call failed: {result.content}")
    return "\n".join(block.text for block in result.content if isinstance(block, TextContent))


async def main() -> None:
    """Connect to the docs server, search for a page, and read it."""
    client = MCPClient.from_dict(config)

    try:
        await client.create_all_sessions()
        session = client.get_session("blockvectra-docs-only")

        tools = await session.list_tools()
        print(f"Available tools: {[tool.name for tool in tools]}")

        search = await session.call_tool(
            name="search_docs",
            arguments={"query": "quickstart", "lang": "en", "limit": 1},
        )
        print(result_text(search))

        read = await session.call_tool(
            name="read_doc",
            arguments={"path": "quickstart", "lang": "en"},
        )
        print(result_text(read))
    finally:
        await client.close_all_sessions()


if __name__ == "__main__":
    asyncio.run(main())
