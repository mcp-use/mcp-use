from fastmcp import FastMCP

server = FastMCP("server")


@server.resource("resource://config")
def get_config_info() -> str:
    """This resource returns config version"""
    return "The config version is 1.0.0"


@server.prompt()
async def assistant_prompt(name: str) -> str:
    """Generate a helpful assistant prompt."""
    return f"You are a helpful assistant for {name}. Be concise and friendly."


if __name__ == "__main__":
    server.run(transport="streamable-http", host="127.0.0.1", port=8080)
