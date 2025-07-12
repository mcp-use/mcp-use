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
    return {"version": "1.0", "status": "ok"}


# 4. Add a Resource Template
@mcp.resource("users://{user_id}/profile")
def get_user_profile(user_id: int) -> dict:
    """Retrieves a user's profile by ID."""
    return {"id": user_id, "name": f"User {user_id}"}


# 5. Add a Prompt
@mcp.prompt
def summarize_text(text: str) -> str:
    """Creates a prompt to summarize text."""
    return f"Please summarize the following text: {text}"


@mcp.tool
async def analyze_sentiment(text: str, ctx: Context) -> str:
    """Analyze the sentiment of text using the client's LLM."""
    prompt = f"""Analyze the sentiment of the following text as positive, negative, or neutral.
    Just output a single word - 'positive', 'negative', or 'neutral'.

    Text to analyze: {text}"""

    # Request LLM analysis
    response = await ctx.sample(prompt)

    return response.text.strip()


if __name__ == "__main__":
    mcp.run(transport="streamable-http", port=8080)
