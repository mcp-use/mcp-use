from fastmcp import FastMCP as FastMCP2

server = FastMCP2(
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
