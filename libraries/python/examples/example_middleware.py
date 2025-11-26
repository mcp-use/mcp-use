"""
Simple middleware example.

This example demonstrates:
1. How to use mcp_use with MCPClient and MCPAgent
2. Default logging middleware (uses logger.debug)
3. Optional custom middleware for specific use cases

Special thanks to https://github.com/microsoft/playwright-mcp for the server.
"""

import asyncio
import time
from typing import Any

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient
from mcp_use.client.middleware import Middleware, MiddlewareContext, NextFunctionT


async def main():
    """Run the example with default logging and optional custom middleware."""
    # Load environment variables
    load_dotenv()

    # Create custom middleware
    class TimingMiddleware(Middleware):
        async def on_request(self, context: MiddlewareContext[Any], call_next: NextFunctionT) -> Any:
            start = time.time()
            try:
                print("--------------------------------")
                print(f"{context.method} started")
                print("--------------------------------")
                print(f"{context.params}, {context.metadata}, {context.timestamp}, {context.connection_id}")
                print("--------------------------------")
                result = await call_next(context)
                return result
            finally:
                duration = time.time() - start
                print("--------------------------------")
                print(f"{context.method} took {int(1000 * duration)}ms")
                print("--------------------------------")

    # Middleware that demonstrates mutating params and adding headers-like metadata
    class MutationMiddleware(Middleware):
        async def on_call_tool(self, context: MiddlewareContext[Any], call_next: NextFunctionT) -> Any:
            # Defensive mutation of params: ensure `arguments` exists before writing
            try:
                print("[MutationMiddleware] context.params=", context.params)
                args = getattr(context.params, "arguments", None)
                if args is None:
                    args = {}

                # Inject a URL argument (example) and a trace id
                args["url"] = "https://github.com"
                meta = args.setdefault("meta", {})
                meta["trace_id"] = "trace-123"

                # Write back the mutated arguments to the params object
                context.params.arguments = args

                # Also demonstrate carrying header-like info via metadata
                context.metadata.setdefault("headers", {})["X-Trace-Id"] = "trace-123"
                # Debug: show the mutated params/metadata immediately
                print("[AddTraceMiddleware] after mutation:", context.params, context.metadata)

            except Exception as e:
                # Don't break the request flow in an example
                print(f"[AddTraceMiddleware] failed to mutate params: {e}")

            return await call_next(context)

    config = {
        "mcpServers": {"playwright": {"command": "npx", "args": ["@playwright/mcp@latest"], "env": {"DISPLAY": ":1"}}}
    }

    # MCPClient includes default logging middleware automatically
    # Add custom middleware only if needed
    # Ensure MutationMiddleware runs before TimingMiddleware so timing logs see mutated params
    client = MCPClient(config=config, middleware=[MutationMiddleware(), TimingMiddleware()])

    # Create LLM
    llm = ChatOpenAI(model="gpt-5")

    # Create agent with the client
    agent = MCPAgent(llm=llm, client=client, max_steps=30, pretty_print=True)

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
