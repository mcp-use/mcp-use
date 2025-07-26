"""
Simple Langfuse Observability Example with Everything MCP Server

This example demonstrates how to use mcp-use with Langfuse observability to automatically
trace AI agent interactions. Just one simple agent.run() call shows you how Langfuse
captures LLM calls, tool usage, and performance metrics with zero code changes.

Features demonstrated:
- Automatic Langfuse integration via environment variables
- Simple exploration and calculation tasks
- Tool execution tracing (multiple tools from server-everything)
- LLM call tracking with token usage
- Performance metrics collection

Prerequisites:
1. Install required dependencies:
   pip install langfuse

2. Set up Langfuse environment variables:
   export LANGFUSE_PUBLIC_KEY="pk-lf-..."
   export LANGFUSE_SECRET_KEY="sk-lf-..."
   # Optional for self-hosted Langfuse
   export LANGFUSE_HOST="https://your-instance.com"

3. Run the example:
   python examples/observability/langfuse_example.py
"""

# Set up debug logging BEFORE importing mcp_use
import os

from dotenv import load_dotenv

import mcp_use

# Load environment variables from .env file
load_dotenv()


def check_langfuse_setup():
    """Check if Langfuse environment variables are configured"""
    public_key = os.getenv("LANGFUSE_PUBLIC_KEY")
    secret_key = os.getenv("LANGFUSE_SECRET_KEY")
    host = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com")

    if public_key and secret_key:
        print("✅ Langfuse keys found")
        print(f"📊 Dashboard: {host}")
        return True
    else:
        print("❌ Langfuse keys not found")
        print("Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY environment variables")
        return False


async def main():
    # Check setup
    if not check_langfuse_setup():
        return

    # Enable debug mode for more detailed output
    mcp_use.set_debug(debug=1)

    # MCP server configuration for server-everything
    everything_server = {
        "mcpServers": {"everything": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-everything"]}}
    }

    print("\n🚀 Starting MCP agent with Everything server...")

    try:
        # Import required classes
        from langchain_openai import ChatOpenAI

        from mcp_use import MCPAgent, MCPClient

        # Create client with server configuration
        client = MCPClient.from_dict(everything_server)

        # Create LLM
        llm = ChatOpenAI(model="gpt-4o", temperature=0)

        # Create agent with Langfuse observability
        agent = MCPAgent(llm=llm, client=client, max_steps=10, auto_initialize=True, verbose=True)

        print("\n📋 Running simple tasks...")

        # Task 1: Simple calculation
        result1 = await agent.run("What is 2 + 2?")
        print(f"📊 Calculation result: {result1}")

        # Task 2: List available tools
        result2 = await agent.run("What tools do you have available?")
        print(f"🛠️ Available tools: {result2}")

        print("\n✅ Example completed!")
        print("📊 Check your Langfuse dashboard for traces and metrics")

    except Exception as e:
        print(f"❌ Error: {e}")
        raise
    finally:
        # Clean up
        if "client" in locals():
            await client.close_all_sessions()


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
