"""
Code Mode Example - Using MCP Tools via Code Execution

This example demonstrates how AI agents can use MCP tools through code execution mode,
which enables more efficient context usage and data processing compared to
direct tool calls.

Based on Anthropic's research: https://www.anthropic.com/engineering/code-execution-with-mcp
"""

import asyncio

from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient
from mcp_use.client.prompts import CODE_MODE_AGENT_PROMPT

# Example configuration with a simple MCP server
# You can replace this with your own server configuration
config = {
    "mcpServers": {
        "filesystem": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
        }
    }
}


async def main():
    """Example 5: AI Agent using code mode (requires OpenAI API key)."""

    client = MCPClient(config=config, code_mode=True)

    # Create LLM
    llm = ChatOpenAI(model="gpt-5-mini")

    # Create agent with code mode instructions
    system_prompt = f"""You are an AI assistant with access to MCP tools via code execution.
{CODE_MODE_AGENT_PROMPT}
"""

    agent = MCPAgent(llm=llm, client=client, system_prompt=system_prompt, max_steps=50)

    try:
        # Example query
        query = """ Please list all the files in the current folder."""

        result = await agent.run(query)
        print(result)

    finally:
        await client.close_all_sessions()


if __name__ == "__main__":
    asyncio.run(main())
