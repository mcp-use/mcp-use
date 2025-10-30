"""
Simple chat example using MCPAgent with built-in conversation memory.

This example demonstrates how to use the MCPAgent with its built-in
conversation history capabilities for better contextual interactions.

Special thanks to https://github.com/microsoft/playwright-mcp for the server.
"""

import asyncio

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient


async def run_memory_chat():
    """Run a chat using MCPAgent's built-in conversation memory."""
    # Load environment variables for API keys
    load_dotenv()

    config = {
        "mcpServers": {"playwright": {"command": "npx", "args": ["@playwright/mcp@latest"], "env": {"DISPLAY": ":1"}}}
    }
    # Create MCPClient from config file
    client = MCPClient(config=config)
    llm = ChatOpenAI(model="gpt-5")

    # Create agent with memory_enabled=True
    agent = MCPAgent(
        llm=llm,
        client=client,
        max_steps=15,
        memory_enabled=True,  # Enable built-in conversation memory
    )

    print("\n===== Interactive MCP Chat =====")
    print("Type 'exit' or 'quit' to end the conversation")
    print("Type 'clear' to clear conversation history")
    print("==================================\n")

    try:
        # Main chat loop
        while True:
            # Get user input
            user_input = input("\nYou: ")

            # Check for exit command
            if user_input.lower() in ["exit", "quit"]:
                print("Ending conversation...")
                break

            # Check for clear history command
            if user_input.lower() == "clear":
                agent.clear_conversation_history()
                print("Conversation history cleared.")
                continue

            # Get response from agent
            print("\nAssistant: ", end="", flush=True)

            try:
                # Run the agent with the user input (memory handling is automatic)
                response = await agent.run(user_input)
                print(response)

            except Exception as e:
                print(f"\nError: {e}")

    finally:
        # Clean up
        if client and client.sessions:
            await client.close_all_sessions()


if __name__ == "__main__":
    asyncio.run(run_memory_chat())
