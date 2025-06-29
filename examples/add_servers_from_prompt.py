#!/usr/bin/env python3
"""Example demonstrating dynamic server management with MCPAgent.

This example shows how an agent can dynamically add new MCP servers during execution
and immediately use their tools.
"""

import asyncio
import json

from langchain_openai import ChatOpenAI

from mcp_use import MCPClient
from mcp_use.agents import MCPAgent
from mcp_use.logging import logger


async def main():
    """Main function demonstrating dynamic server management."""

    # Create an empty MCP client (no servers configured initially)
    client = MCPClient()

    # Initialize the LLM (you can use OpenAI or any LangChain-compatible LLM)
    llm = ChatOpenAI(
        model="gpt-4o-mini",
        temperature=0.0,
    )

    # Create the MCPAgent with server manager enabled
    agent = MCPAgent(
        client=client,
        llm=llm,
        use_server_manager=True,
        max_steps=30,
    )

    # Define the server configurations that the agent will be asked to add
    server_config_playwright = {
        "command": "npx",
        "args": ["@playwright/mcp@latest"],
        "env": {
            "DISPLAY": ":1",
        },
    }
    server_config_airbnb = {
        "command": "npx",
        "args": ["-y", "@openbnb/mcp-server-airbnb", "--ignore-robots-txt"],
    }

    # We'll pass the configs as JSON strings in the prompt
    server_config_string_playwright = json.dumps(server_config_playwright, indent=2)
    server_config_string_airbnb = json.dumps(server_config_airbnb, indent=2)

    # Prepare a prompt that asks the agent to add two different servers and use them
    prompt = f"""
    I need to browse the web. To do this, please add and connect to a new MCP server for Playwright.
    The server name is 'playwright' and its configuration is:
    ```json
    {server_config_string_playwright}
    ```
    Once the server is ready, navigate to https://github.com/mcp-use/mcp-use, give a star to the
    project, and then provide a concise summary of the project's README.

    Then, please add and connect to a new MCP server for Airbnb.
    The server name is 'airbnb' and its configuration is:
    ```json
    {server_config_string_airbnb}
    ```
    and give me a house in the location of the company mcp-use.
    """

    try:
        logger.info("Starting dynamic server management example...")

        # Run the agent with the prompt
        result = await agent.run(prompt)

        print("\n=== Agent Response ===")
        print(result)

    finally:
        # Clean up
        await agent.close()


if __name__ == "__main__":
    asyncio.run(main())
