"""
Simple middleware example.

This example demonstrates:
1. How to use mcp_use with MCPClient and MCPAgent
2. Default logging middleware (uses logger.debug)
3. Optional custom middleware for specific use cases

Special thanks to https://github.com/microsoft/playwright-mcp for the server.
"""

import asyncio

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient
from mcp_use.middleware import MCPRequestContext, NextFunctionT


async def main():
    """Run the example with default logging and optional custom middleware."""
    # Load environment variables
    load_dotenv()

    # Optional: Add custom middleware if needed
    async def custom_browser_middleware(request: MCPRequestContext, call_next: NextFunctionT):
        """Custom middleware for browser automation."""
        if "browser" in request.method:
            print(f"🌐 Browser action: {request.method}")

        result = await call_next()

        if "browser" in request.method:
            print(f"✅ Browser action completed: {request.method}")

        return result

    config = {
        "mcpServers": {"playwright": {"command": "npx", "args": ["@playwright/mcp@latest"], "env": {"DISPLAY": ":1"}}}
    }

    # MCPClient includes default logging middleware automatically
    # Add custom middleware only if needed
    client = MCPClient(config=config, middleware=[custom_browser_middleware])

    # Create LLM
    llm = ChatOpenAI(model="gpt-4o")

    # Create agent with the client
    agent = MCPAgent(llm=llm, client=client, max_steps=30)

    # Run the query
    result = await agent.run(
        """
        Navigate to https://github.com/mcp-use/mcp-use, give a star to the project and write
        a summary of the project.
        """,
        max_steps=30,
    )
    print(f"\nResult: {result}")


if __name__ == "__main__":
    asyncio.run(main())
