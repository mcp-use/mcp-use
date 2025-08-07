"""
Advanced Langfuse Observability Example with Constructor-Level Configuration

This example demonstrates how to use the new constructor-level observability configuration
to enable advanced Langfuse tracing with detailed settings for trace level, tool input/output
capture, context capture, and sensitive data filtering.

Features demonstrated:
- Constructor-level observability configuration
- Advanced Langfuse settings (trace level, capture options)
- Session and user ID tracking
- Custom metadata for traces
- Backward compatibility with environment variable setup

Prerequisites:
1. Install required dependencies:
   pip install langfuse

2. Set up Langfuse environment variables:
   export LANGFUSE_PUBLIC_KEY="pk-lf-..."
   export LANGFUSE_SECRET_KEY="sk-lf-..."
   # Optional for self-hosted Langfuse
   export LANGFUSE_HOST="https://your-instance.com"

3. Run the example:
   python examples/observability/advanced_langfuse_example.py
"""

import asyncio
import logging
import os
import uuid

from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Configure logging to see observability debug messages
logging.basicConfig(level=logging.DEBUG, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")

# Only show debug logs for mcp_use modules to avoid noise
logging.getLogger("mcp_use.agents.mcpagent").setLevel(logging.DEBUG)
logging.getLogger("mcp_use.observability").setLevel(logging.DEBUG)

# Reduce noise from other libraries
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("langchain").setLevel(logging.WARNING)
logging.getLogger("openai").setLevel(logging.WARNING)


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


async def example_basic_configuration():
    """Example with basic Langfuse configuration."""
    print("\n🔥 Example 1: Basic Langfuse Configuration")

    from langchain_openai import ChatOpenAI

    from mcp_use import MCPAgent, MCPClient
    from mcp_use.observability import LangfuseObservabilityConfig

    # Basic Langfuse configuration
    observability_config = {"langfuse": LangfuseObservabilityConfig(enabled=True, trace_level="basic")}

    # MCP server configuration
    everything_server = {
        "mcpServers": {"everything": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-everything"]}}
    }

    # Create client and agent
    client = MCPClient.from_dict(everything_server)
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

    # Create agent with observability configuration
    agent = MCPAgent(
        llm=llm,
        client=client,
        max_steps=5,
        auto_initialize=True,
        verbose=True,
        observability=observability_config,  # Constructor-level configuration
    )

    # Run a simple task
    result = await agent.run("What is 15 + 27?")
    print(f"📊 Basic result: {result}")

    # Clean up
    await client.close_all_sessions()


async def example_detailed_configuration():
    """Example with detailed Langfuse configuration."""
    print("\n🔥 Example 2: Detailed Langfuse Configuration")

    from langchain_openai import ChatOpenAI

    from mcp_use import MCPAgent, MCPClient
    from mcp_use.observability import LangfuseObservabilityConfig

    # Generate unique session ID for this run
    session_id = f"session_{uuid.uuid4().hex[:8]}"

    # Detailed Langfuse configuration
    observability_config = {
        "langfuse": LangfuseObservabilityConfig(
            enabled=True,
            trace_level="detailed",  # More detailed tracing
            capture_tool_inputs=True,
            capture_tool_outputs=True,
            capture_context=True,
            filter_sensitive_data=True,
            session_id=session_id,
            user_id="demo_user",
            metadata={"example_type": "detailed_configuration", "environment": "development"},
        )
    }

    # MCP server configuration
    everything_server = {
        "mcpServers": {"everything": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-everything"]}}
    }

    # Create client and agent
    client = MCPClient.from_dict(everything_server)
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

    # Create agent with detailed observability configuration
    agent = MCPAgent(
        llm=llm, client=client, max_steps=10, auto_initialize=True, verbose=True, observability=observability_config
    )

    # Run more complex tasks
    result1 = await agent.run("List available tools and then calculate 42 * 17")
    print(f"📊 Detailed result 1: {result1}")

    result2 = await agent.run("What tools did I just use in the previous query?")
    print(f"📊 Detailed result 2: {result2}")

    # Clean up
    await client.close_all_sessions()


async def example_verbose_configuration():
    """Example with verbose Langfuse configuration."""
    print("\n🔥 Example 3: Verbose Langfuse Configuration")

    from langchain_openai import ChatOpenAI

    from mcp_use import MCPAgent, MCPClient
    from mcp_use.observability import LangfuseObservabilityConfig

    # Generate unique session ID for this run
    session_id = f"verbose_session_{uuid.uuid4().hex[:8]}"

    # Verbose Langfuse configuration - maximum detail
    observability_config = {
        "langfuse": LangfuseObservabilityConfig(
            enabled=True,
            trace_level="verbose",  # Maximum detail
            capture_tool_inputs=True,
            capture_tool_outputs=True,
            capture_context=True,
            filter_sensitive_data=False,  # Capture everything for debugging
            session_id=session_id,
            user_id="advanced_demo_user",
            metadata={
                "example_type": "verbose_configuration",
                "environment": "development",
                "debug_mode": True,
                "capture_level": "maximum",
            },
        )
    }

    # MCP server configuration
    everything_server = {
        "mcpServers": {"everything": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-everything"]}}
    }

    # Create client and agent
    client = MCPClient.from_dict(everything_server)
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

    # Create agent with verbose observability configuration
    agent = MCPAgent(
        llm=llm, client=client, max_steps=10, auto_initialize=True, verbose=True, observability=observability_config
    )

    # Run complex multi-step task
    result = await agent.run(
        "First, list all available tools. Then calculate the factorial of 5. "
        "Finally, tell me what mathematical operations were performed."
    )
    print(f"📊 Verbose result: {result}")

    # Clean up
    await client.close_all_sessions()


async def example_dict_configuration():
    """Example using dictionary-based configuration for convenience."""
    print("\n🔥 Example 4: Dictionary-based Configuration")

    from langchain_openai import ChatOpenAI

    from mcp_use import MCPAgent, MCPClient

    # Dictionary-based configuration (more concise)
    observability_config = {
        "langfuse": {
            "enabled": True,
            "trace_level": "detailed",
            "capture_tool_inputs": True,
            "capture_tool_outputs": True,
            "capture_context": True,
            "filter_sensitive_data": True,
            "session_id": f"dict_session_{uuid.uuid4().hex[:8]}",
            "metadata": {"config_type": "dictionary"},
        }
    }

    # MCP server configuration
    everything_server = {
        "mcpServers": {"everything": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-everything"]}}
    }

    # Create client and agent
    client = MCPClient.from_dict(everything_server)
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

    # Create agent with dictionary-based observability configuration
    agent = MCPAgent(
        llm=llm, client=client, max_steps=5, auto_initialize=True, verbose=True, observability=observability_config
    )

    # Run task
    result = await agent.run("Calculate 123 + 456 and explain the steps")
    print(f"📊 Dictionary config result: {result}")

    # Clean up
    await client.close_all_sessions()


async def main():
    """Run all examples."""
    # Check setup
    if not check_langfuse_setup():
        return

    print("\n🚀 Starting Advanced Langfuse Observability Examples...")
    print("🔍 These examples will create detailed traces in your Langfuse dashboard")
    print("📊 Check your dashboard after running to see the different trace levels\n")

    try:
        # Run all examples
        await example_basic_configuration()
        await example_detailed_configuration()
        await example_verbose_configuration()
        await example_dict_configuration()

        print("\n✅ All examples completed successfully!")
        print("📊 Check your Langfuse dashboard to see the different trace levels and configurations")
        print("🔍 Each example created traces with different levels of detail and metadata")

    except Exception as e:
        print(f"❌ Error: {e}")
        raise


if __name__ == "__main__":
    asyncio.run(main())
