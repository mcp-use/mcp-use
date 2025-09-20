from mcp_use.server import Server

# 1. Create an mcp-use Server instance
server = Server(
    name="Example Server",
    version="0.1.0",
    instructions="This is an example server with a simple echo tool.",
    dev_mode=True,
)


# 2. Define a tool using the @server.tool() decorator
@server.tool(description="Echoes back the message you provide.", structured_output=False)
async def echo(message: str) -> str:
    """Echoes back the message you provide."""
    return f"You said: {message} Lupo"


# 3. Run the mcp-use Server
if __name__ == "__main__":
    server.run(reload=True)
