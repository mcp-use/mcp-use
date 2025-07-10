"""
Example demonstrating the callback mechanism for tool execution in MCPAgent.

This example shows how to use the new options parameter with callbacks
to monitor tool execution lifecycle events.
"""

import asyncio
from typing import Any

from langchain_openai import ChatOpenAI

from mcp_use import MCPClient
from mcp_use.agents import MCPAgent
from mcp_use.types import AgentOptions


def on_tool_start(tool_name: str, tool_input: dict[str, Any]) -> None:
    """Called when a tool execution starts."""
    print(f"🚀 Starting tool: {tool_name}")
    print(f"   Input: {tool_input}")


def on_tool_complete(tool_name: str, tool_input: dict[str, Any], tool_result: Any) -> None:
    """Called when a tool execution completes successfully."""
    print(f"✅ Completed tool: {tool_name}")
    print(f"   Result length: {len(str(tool_result))} characters")


def on_tool_error(tool_name: str, tool_input: dict[str, Any], error: Exception) -> None:
    """Called when a tool execution fails with an error."""
    print(f"❌ Tool failed: {tool_name}")
    print(f"   Error: {error}")


async def main():
    """Main example function."""
    # Configure agent options with callbacks
    options: AgentOptions = {
        "callbacks": {
            "on_tool_start": on_tool_start,
            "on_tool_complete": on_tool_complete,
            "on_tool_error": on_tool_error,
        }
    }

    # Initialize LLM
    llm = ChatOpenAI(model="gpt-4")

    # Create MCP client with your server configuration
    client = MCPClient.from_dict(
        {
            "filesystem": {
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
                "transport": "stdio",
            }
        }
    )

    # Create agent with callback options
    agent = MCPAgent(
        llm=llm,
        client=client,
        options=options,  # Pass the options with callbacks
    )

    try:
        # Run a query that will trigger tool execution
        # The callbacks will be invoked during tool execution
        result = await agent.run("List the files in the current directory and tell me about one of them")
        print(f"\n🎉 Final result: {result}")

    finally:
        await agent.close()


if __name__ == "__main__":
    asyncio.run(main())
