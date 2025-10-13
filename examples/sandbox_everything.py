"""
This example shows how to test the different functionalities of MCPs using the MCP server from
OpenAI in a sandboxed environment using E2B.
"""

import asyncio
import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

import mcp_use
from mcp_use import MCPAgent, MCPClient
from mcp_use.types.sandbox import SandboxOptions

mcp_use.set_debug(debug=1)

# Server configuration (MCP standard compliant)
sandboxed_server = {
    "mcpServers": {
        "everything": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-everything"],
        }
    }
}


async def main():
    """Run the example using a sandboxed environment."""
    # Load environment variables (needs E2B_API_KEY)
    load_dotenv()

    # Ensure E2B API key is available
    if not os.getenv("E2B_API_KEY"):
        raise ValueError("E2B_API_KEY environment variable is required")

    # E2B sandbox options
    sandbox_options: SandboxOptions = {
        "api_key": os.getenv("E2B_API_KEY"),  # E2B API key to create the sandbox
        "sandbox_template_id": "code-interpreter-v1",  # Use code interpreter template
    }

    # Create client with sandboxed mode enabled and sandbox options
    client = MCPClient(config=sandboxed_server, sandbox=True, sandbox_options=sandbox_options)

    # Create LLM and agent
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
    agent = MCPAgent(llm=llm, client=client, max_steps=30)

    try:
        # Run the same test query
        result = await agent.run(
            """
            Run echo "test" and then echo "second test" again and then add 1 + 1
            """,
            max_steps=30,
        )
        print(f"\nResult: {result}")
    finally:
        # Ensure we clean up resources properly
        await client.close_all_sessions()


if __name__ == "__main__":
    asyncio.run(main())
