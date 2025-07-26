"""
Simple Laminar Observability Example with Everything MCP Server

This example demonstrates how to use mcp-use with Laminar observability to automatically
trace AI agent interactions. Just one simple agent.run() call shows you how Laminar
captures LLM calls, tool usage, and performance metrics with zero code changes.

Features demonstrated:
- Automatic Laminar integration via environment variables
- Simple exploration and calculation tasks
- Tool execution tracing (multiple tools from server-everything)
- LLM call tracking with token usage
- Performance metrics collection

Prerequisites:
1. Install required dependencies:
   pip install lmnr

2. Set up Laminar environment variables:
   export LAMINAR_PROJECT_API_KEY="your-api-key-here"

3. Run the example:
   python examples/observability/laminar_example.py
"""

# Set up debug logging BEFORE importing mcp_use
import os

from dotenv import load_dotenv

import mcp_use

# Load environment variables from .env file
load_dotenv()


def check_laminar_setup():
    """Check if Laminar environment variables are configured"""
    api_key = os.getenv("LAMINAR_PROJECT_API_KEY")

    if api_key:
        print("✅ Laminar API key found")
        print(f"   API Key: {api_key[:8]}...")
        print("📊 Dashboard: https://app.lmnr.ai")
        return True
    else:
        print("❌ Laminar API key not found")
        print("Set LAMINAR_PROJECT_API_KEY environment variable")
        print("Sign up at https://lmnr.ai to get your API key")
        return False


async def main():
    # Check setup
    if not check_laminar_setup():
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

        # Create agent with Laminar observability
        agent = MCPAgent(llm=llm, client=client, max_steps=10, auto_initialize=True, verbose=True)

        print("\n📋 Running simple tasks...")

        # Task 1: Simple calculation
        result1 = await agent.run("What is 2 + 2?")
        print(f"📊 Calculation result: {result1}")

        # Task 2: List available tools
        result2 = await agent.run("What tools do you have available?")
        print(f"🛠️ Available tools: {result2}")

        print("\n✅ Example completed!")
        print("📊 Check your Laminar dashboard for traces and metrics")

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
