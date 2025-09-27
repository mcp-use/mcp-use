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
from mcp.types import CallToolRequestParams, CallToolResult

from mcp_use import MCPAgent, MCPClient
from mcp_use.middleware import MiddlewareContext, NextFunctionT
from mcp_use.middleware.middleware import Middleware


async def main():
    """Run the example with default logging and optional custom middleware."""
    # Load environment variables
    load_dotenv()

    # Create custom middleware
    class CustomMiddleware(Middleware):
        async def on_call_tool(
            self, context: MiddlewareContext[CallToolRequestParams], call_next: NextFunctionT
        ) -> CallToolResult:
            print(f"Calling tool {context.params.name}")
            return await call_next(context)

    config = {
        "mcpServers": {"playwright": {"command": "npx", "args": ["@playwright/mcp@latest"], "env": {"DISPLAY": ":1"}}}
    }

    # MCPClient includes default logging middleware automatically
    # Add custom middleware only if needed
    client = MCPClient(config=config, middleware=[CustomMiddleware()])

    # Create LLM
    llm = ChatOpenAI(model="gpt-4o")

    # Create agent with the client
    agent = MCPAgent(llm=llm, client=client, max_steps=30)

    # Run the query
    result = await agent.run(
        """
        Navigate to https://github.com/mcp-use/mcp-use and write
        a summary of the project.
        """,
        max_steps=30,
    )
    print(f"\nResult: {result}")


if __name__ == "__main__":
    asyncio.run(main())
