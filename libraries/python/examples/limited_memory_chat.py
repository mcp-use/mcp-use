"""
Simple chat example using MCPAgent with limited conversation memory.

This example demonstrates how to use the MCPAgent with limited
conversation history for better contextual interactions while
keeping memory usage controlled.

Special thanks to https://github.com/microsoft/playwright-mcp for the server.
"""

import asyncio

from dotenv import load_dotenv
from langchain_core.messages import AIMessage, HumanMessage
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient


async def run_limited_memory_chat():
    """Run a chat using MCPAgent with limited conversation memory."""
    # Load environment variables for API keys
    load_dotenv()

    config = {
        "mcpServers": {"playwright": {"command": "npx", "args": ["@playwright/mcp@latest"], "env": {"DISPLAY": ":1"}}}
    }
    # Create MCPClient from config file
    client = MCPClient(config=config)
    llm = ChatOpenAI(model="gpt-5")
    # Create agent with memory_enabled=False but pass external history
    agent = MCPAgent(
        llm=llm,
        client=client,
        max_steps=15,
        memory_enabled=True,  # Disable built-in memory, use external history
        pretty_print=True,
    )

    # Configuration: Limited history mode
    MAX_HISTORY_MESSAGES = 5

    print("\n===== Interactive MCP Chat (Limited Memory) =====")
    print("Type 'exit' or 'quit' to end the conversation")
    print("Type 'clear' to clear conversation history")
    print("==================================\n")

    try:
        # Main chat loop with limited history
        external_history = []

        while True:
            # Get user input
            user_input = input("\nYou: ")

            # Check for exit command
            if user_input.lower() in ["exit", "quit"]:
                print("Ending conversation...")
                break

            # Check for clear history command
            if user_input.lower() == "clear":
                external_history = []
                print("Conversation history cleared.")
                continue

            # Get response from agent
            try:
                # Limit history to last N messages
                limited_history = external_history[-MAX_HISTORY_MESSAGES:] if external_history else []
                # Run the agent with the user input and limited history
                print("\nAssistant: ", end="", flush=True)
                response = await agent.run(user_input, external_history=limited_history)
                print(response)
                # Add to external history
                external_history.append(HumanMessage(content=user_input))
                external_history.append(AIMessage(content=response))

            except Exception as e:
                print(f"\nError: {e}")

    finally:
        # Clean up
        if client and client.sessions:
            await client.close_all_sessions()


if __name__ == "__main__":
    asyncio.run(run_limited_memory_chat())
