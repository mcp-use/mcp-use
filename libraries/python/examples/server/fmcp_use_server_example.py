from datetime import datetime

from mcp.server.fastmcp import Context
from mcp.types import ToolAnnotations

from mcp_use import MCPServer

# 1. Create an mcp-use Server instance
server = MCPServer(
    name="Example Server",
    version="0.1.0",
    instructions="This is an example server with a simple echo tool.",
    debug=True,
    pretty_print_jsonrpc=True,
)


def lupo_tool(a: int, b: int) -> str:
    return str(a) + str(b) + "lupo"


# 2. Define a tool using the @server.tool() decorator
@server.tool(
    name="echo",
    title="Echo",
    description="Echoes back the message you provide.",
    annotations=ToolAnnotations(
        title="Echo",
        readOnlyHint=False,
        destructiveHint=False,
        openWorldHint=False,
        idempotentHint=False,
    ),
    structured_output=True,
)
async def echo(message: str, context: Context) -> str:
    """Echoes back the message you provide."""
    return f"You said: {message} one"


@server.resource(
    uri="time://current",
    name="current_time",
    title="Current Time",
    description="Returns the current time.",
    mime_type="text/plain",
)
async def current_time() -> str:
    return datetime.now().isoformat()


@server.prompt(name="help", title="Help", description="Returns a help message.")
async def help_prompt(context: Context) -> str:
    return "This is a help message."


@server.resource(
    uri="template://{template_name}",
    name="template_message",
    title="Template Message",
    description="Returns a template message based on the template name parameter.",
    mime_type="text/plain",
)
async def template_message(template_name: str) -> str:
    """Returns a template message based on the template name parameter."""
    if template_name == "help":
        return "This is a help message."
    elif template_name == "time":
        return datetime.now().isoformat()
    else:
        return "This is a template message."


# 3. Run the server with TUI chat interface
if __name__ == "__main__":
    # Example with custom paths (optional)
    # server = MCPServer(
    #     name="Example Server",
    #     version="0.1.0",
    #     instructions="This is an example server with a simple echo tool.",
    #     debug=True,  # Enable debug mode (adds dev routes)
    #     mcp_path="/api/mcp",  # Custom MCP endpoint
    #     docs_path="/custom-docs",
    #     inspector_path="/custom-inspector",
    #     openmcp_path="/custom-openmcp.json"
    # )

    server.run(transport="streamable-http", port=8000, reload=True)
