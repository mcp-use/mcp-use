from mcp.server.fastmcp import Context

from mcp_use import MCPServer

# 1. Create an mcp-use Server instance
server = MCPServer(
    name="Example Server",
    version="0.1.0",
    instructions="This is an example server with a simple echo tool.",
    debug=True,
)


def lupo_tool(a: int, b: int) -> str:
    return str(a) + str(b) + "lupo"


# 2. Define a tool using the @server.tool() decorator
@server.tool(description="Echoes back the message you provide.", structured_output=False)
async def echone(message: str, context: Context) -> str:
    """Echoes back the message you provide."""
    return f"You said: {message} one"


# 3. Run the server with TUI chat interface
if __name__ == "__main__":
    server.run(transport="streamable-http", reload=True, host="0.0.0.0", debug=False)
