import json
from dataclasses import dataclass

from mcp.types import SamplingMessage, TextContent

from mcp_use.server import Context, MCPServer

# 1. Create a server instance
mcp = MCPServer(name="PrimitiveServer")


# 2. Add a Tool
@mcp.tool()
def add(a: int, b: int) -> int:
    """Adds two integers together."""
    return a + b


# 3. Add a Resource
@mcp.resource("data://config")
def get_config() -> str:
    """Returns the application configuration."""
    return json.dumps({"version": "1.0", "status": "ok"})


# 4. Add a Resource Template
@mcp.resource("users://{user_id}/profile")
def get_user_profile(user_id: int) -> str:
    """Retrieves a user's profile by ID."""
    return json.dumps({"id": user_id, "name": f"User {user_id}"})


# 5. Add a Prompt
@mcp.prompt()
def summarize_text(text: str) -> str:
    """Creates a prompt to summarize text."""
    return f"Please summarize the following text: {text}"


# Tool with all kinds of notifications
@mcp.tool()
async def long_running_task(task_name: str, ctx: Context, steps: int = 5) -> str:
    """Execute a task with progress updates."""
    await ctx.info(f"Starting: {task_name}")

    for i in range(steps):
        progress = (i + 1) / steps
        await ctx.send_prompt_list_changed()
        await ctx.send_resource_list_changed()
        await ctx.send_tool_list_changed()
        await ctx.report_progress(
            progress=progress,
            total=1.0,
            message=f"Step {i + 1}/{steps}",
        )
        await ctx.debug(f"Completed step {i + 1}")

    return f"Task '{task_name}' completed"


# Tool with no notifications, but logging
@mcp.tool()
async def logging_tool(ctx: Context) -> str:
    """Log a message to the client."""
    await ctx.debug("This is a debug message")
    await ctx.info("This is an info message")
    await ctx.warning("This is a warning message")
    await ctx.error("This is an error message")
    return "Logging tool completed"


# TODO: Enable these once server supports it.
# @mcp.tool()
# async def tool_to_disable():
#     """A tool to disable."""
#     return "Tool to disable"


# @mcp.tool()
# async def change_tools(ctx: Context) -> str:
#     """Disable the logging_tool."""
#     await tool_to_disable.disable()
#     return "Tools disabled"


# @mcp.resource("data://mock")
# def resource_to_disable():
#     """A resource to disable."""
#     pass


# @mcp.tool()
# async def change_resources(ctx: Context) -> str:
#     """Disable the get_config resource."""
#     await resource_to_disable.disable()
#     return "Resources disabled"


# @mcp.prompt()
# def prompt_to_disable():
#     """A prompt to disable."""
#     pass


# @mcp.tool()
# async def change_prompts(ctx: Context) -> str:
#     """Disable the summarize_text prompt."""
#     await prompt_to_disable.disable()
#     return "Prompts disabled"


@mcp.tool()
async def analyze_sentiment(text: str, ctx: Context) -> str:
    """Analyze the sentiment of text using the client's LLM."""
    prompt = f"""Analyze the sentiment of the following text as positive, negative, or neutral.
    Just output a single word - 'positive', 'negative', or 'neutral'.

    Text to analyze: {text}"""

    message = SamplingMessage(role="user", content=TextContent(type="text", text=prompt))

    # Request LLM analysis
    response = await ctx.sample(messages=[message])

    if isinstance(response.content, TextContent):
        return response.content.text.strip()
    return ""


@mcp.tool()
async def get_client_roots(ctx: Context) -> str:
    """Request and return the list of roots from the client.

    This tool demonstrates the roots capability - it requests the
    list of file/directory roots that the client has made available.
    """
    roots = await ctx.list_roots()
    if not roots:
        return json.dumps({"roots": [], "count": 0})

    roots_data = [{"uri": str(r.uri), "name": r.name} for r in roots]
    return json.dumps({"roots": roots_data, "count": len(roots)})


# Subscribable resource for subscription tests
_live_value = "initial"


@mcp.resource(uri="data://live", name="live_data", mime_type="text/plain")
def get_live_data() -> str:
    """A resource that supports subscriptions."""
    return _live_value


@mcp.tool()
async def set_live_data(value: str) -> str:
    """Update the live data resource and notify subscribers."""
    global _live_value
    _live_value = value
    await mcp.notify_resource_updated("data://live")
    return f"Updated to: {value}"


@dataclass
class Info:
    quantity: int
    unit: str


@mcp.tool()
async def purchase_item(ctx: Context) -> str:
    """Elicit the user to provide information about a purchase."""
    result = await ctx.elicit(message="Please provide your information", schema=Info)
    if result.action == "accept":
        info = result.data
        return f"You are buying {info.quantity} {info.unit} of the item"
    elif result.action == "decline":
        return "Information not provided"
    else:
        return "Operation cancelled"


if __name__ == "__main__":
    mcp.run(transport="streamable-http", port=8080)
