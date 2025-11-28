"""
Code Mode Example - Using MCP Tools via Code Execution

This example demonstrates how AI agents can use MCP tools through code execution mode,
which enables more efficient context usage and data processing compared to
direct tool calls.

Based on Anthropic's research: https://www.anthropic.com/engineering/code-execution-with-mcp
"""

import asyncio

from langchain_anthropic import ChatAnthropic

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

    # You can configure semantic search mode:
    # - "string_match" (default): Simple substring matching
    # - "fuzzy": Fuzzy search (requires thefuzz)
    # - "embeddings": Semantic search (requires OPENAI_API_KEY or embeddings_url)
    from mcp_use.client.client import CodeModeConfig, SemanticSearchConfig

    client = MCPClient(
        config=config,
        code_mode=CodeModeConfig(
            enabled=True,
            semantic=SemanticSearchConfig(mode="string_match")
        ),
    )

    # Create LLM
    llm = ChatAnthropic(model="claude-haiku-4-5-20251001")

    # Create agent with code mode instructions
    agent = MCPAgent(
        llm=llm,
        client=client,
        system_prompt=CODE_MODE_AGENT_PROMPT,
        max_steps=50,
        pretty_print=True,
    )

    # Example query
    query = """ Please list all the files in the current folder."""

    async for _ in agent.stream_events(query):
        pass


if __name__ == "__main__":
    asyncio.run(main())
