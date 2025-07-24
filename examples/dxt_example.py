"""
DXT Example for mcp_use.

This example demonstrates how to use the mcp_use library with MCPClient
to load and connect to MCP servers packaged as DXT (Desktop Extension) files.

A DXT file is a zip archive containing:
- manifest.json: Extension metadata and configuration
- server/: MCP server implementation files
- dependencies/: All required packages/libraries

Before running this example:
1. You need a valid .dxt file
2. The DXT file should contain a complete MCP server with all dependencies
"""

import asyncio

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient
from mcp_use.dxt import DXTParser, validate_user_config


async def inspect_dxt_file(dxt_path: str):
    """Inspect a DXT file and show its configuration requirements."""
    print(f"\n🔍 Inspecting DXT file: {dxt_path}")

    try:
        with DXTParser(dxt_path) as parser:
            print(f"📦 Extension name: {parser.get_server_name()}")
            print(f"📋 Manifest version: {parser.manifest.get('dxt_version', 'unknown')}")
            print(f"👤 Author: {parser.manifest.get('author', {}).get('name', 'unknown')}")
            print(f"📝 Description: {parser.manifest.get('description', 'No description')}")

            # Show user configuration requirements
            user_config_schema = parser.get_user_config_schema()
            if user_config_schema:
                print("\n⚙️ User configuration required:")
                for key, config_def in user_config_schema.items():
                    required = config_def.get("required", False)
                    title = config_def.get("title", key)
                    description = config_def.get("description", "No description")
                    print(f"  • {title} ({'required' if required else 'optional'}): {description}")
            else:
                print("\n✅ No user configuration required")

    except Exception as e:
        print(f"❌ Error inspecting DXT file: {e}")
        return False

    return True


async def run_dxt_example_basic(dxt_path: str):
    """Run a basic DXT example without user configuration."""
    print(f"\n🚀 Running basic DXT example with: {dxt_path}")

    try:
        # Create MCPClient from DXT file
        client = MCPClient.from_dxt_file(dxt_path)

        # Create LLM
        llm = ChatOpenAI(model="gpt-4o")

        # Create agent with the client
        agent = MCPAgent(llm=llm, client=client, max_steps=10)

        # Run a simple query
        result = await agent.run(
            "Hello! What tools are available to me?",
            max_steps=5,
        )
        print(f"\n✅ Result: {result}")

    except Exception as e:
        print(f"❌ Error running DXT example: {e}")
    finally:
        # Ensure we clean up resources properly
        if "client" in locals() and client.sessions:
            await client.close_all_sessions()


async def run_dxt_example_with_config(dxt_path: str, user_config: dict):
    """Run a DXT example with user configuration."""
    print(f"\n🚀 Running DXT example with user config: {dxt_path}")
    print(f"🔧 User configuration: {user_config}")

    try:
        # Validate user configuration first
        validate_user_config(dxt_path, user_config)
        print("✅ User configuration validated")

        # Create MCPClient from DXT file with user config
        client = MCPClient.from_dxt_file(dxt_path, user_config=user_config)

        # Create LLM
        llm = ChatOpenAI(model="gpt-4o")

        # Create agent with the client
        agent = MCPAgent(llm=llm, client=client, max_steps=10)

        # Run a query
        result = await agent.run(
            "What can you help me with? Show me what tools are available.",
            max_steps=5,
        )
        print(f"\n✅ Result: {result}")

    except Exception as e:
        print(f"❌ Error running DXT example: {e}")
    finally:
        # Ensure we clean up resources properly
        if "client" in locals() and client.sessions:
            await client.close_all_sessions()


async def main():
    """Main function to demonstrate DXT usage."""
    # Load environment variables
    load_dotenv()

    # Example DXT file path - replace with your actual DXT file
    dxt_path = "example-server.dxt"

    print("🎯 DXT (Desktop Extension) Example for mcp-use")
    print("=" * 50)

    # First, inspect the DXT file to understand its requirements
    if not await inspect_dxt_file(dxt_path):
        print("❌ Cannot proceed without a valid DXT file")
        print("📋 To create a DXT file, see: https://github.com/anthropics/dxt")
        return

    # Run basic example (no user config)
    await run_dxt_example_basic(dxt_path)

    # Example with user configuration
    # Replace this with actual configuration values required by your DXT
    user_config = {"api_key": "your_api_key_here", "allowed_directories": "/safe/workspace/path"}

    print("\n" + "=" * 50)
    await run_dxt_example_with_config(dxt_path, user_config)


if __name__ == "__main__":
    asyncio.run(main())
