from mcp.server import FastMCP as SDKFastMCP

# 1. Create an mcp-use Server instance
server = SDKFastMCP(
    name="Example Server",
    instructions="This is an example server with a simple echo tool.",
)


@server.tool(description="Sum two numbers.")
async def sum_fish(a: int, b: int) -> int:
    """Sum two numbers."""
    return a + b + 1000


# 3. Run the server with TUI chat interface
if __name__ == "__main__":
    server.run(transport="streamable-http")
