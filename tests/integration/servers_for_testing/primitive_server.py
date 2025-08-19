import json
from dataclasses import dataclass

from fastmcp import Context, FastMCP

# 1. Create a server instance
mcp = FastMCP(name="PrimitiveServer")


# 2. Add a Tool
@mcp.tool
def add(a: int, b: int) -> int:
    """Adds two integers together."""
    return a + b


# 3. Add a Resource
@mcp.resource("data://config")
def get_config() -> dict:
    """Returns the application configuration."""
    return json.dumps({"version": "1.0", "status": "ok"})


# 4. Add a Resource Template
@mcp.resource("users://{user_id}/profile")
def get_user_profile(user_id: int) -> dict:
    """Retrieves a user's profile by ID."""
    return json.dumps({"id": user_id, "name": f"User {user_id}"})


# 5. Add a Prompt
@mcp.prompt
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


@mcp.tool()
async def tool_to_disable():
    """A tool to disable."""
    return "Tool to disable"


@mcp.tool()
async def change_tools(ctx: Context) -> str:
    """Disable the logging_tool."""
    await tool_to_disable.disable()
    return "Tools disabled"


@mcp.resource("data://mock")
def resource_to_disable():
    """A resource to disable."""
    pass


@mcp.tool()
async def change_resources(ctx: Context) -> str:
    """Disable the get_config resource."""
    await resource_to_disable.disable()
    return "Resources disabled"


@mcp.prompt()
def prompt_to_disable():
    """A prompt to disable."""
    pass


@mcp.tool()
async def change_prompts(ctx: Context) -> str:
    """Disable the summarize_text prompt."""
    await prompt_to_disable.disable()
    return "Prompts disabled"


@mcp.tool
async def analyze_sentiment(text: str, ctx: Context) -> str:
    """Analyze the sentiment of text using the client's LLM."""
    prompt = f"""Analyze the sentiment of the following text as positive, negative, or neutral.
    Just output a single word - 'positive', 'negative', or 'neutral'.

    Text to analyze: {text}"""

    # Request LLM analysis
    response = await ctx.sample(prompt)

    return response.text.strip()


@dataclass
class Info:
    quantity: int
    unit: str


@mcp.tool
async def purchase_item(ctx: Context) -> str:
    """Elicit the user to provide information about a purchase."""
    result = await ctx.elicit(message="Please provide your information", response_type=Info)
    if result.action == "accept":
        info = result.data
        return f"You are buying {info.quantity} {info.unit} of the item"
    elif result.action == "decline":
        return "Information not provided"
    else:
        return "Operation cancelled"


if __name__ == "__main__":
    mcp.run(transport="streamable-http", port=8080)
