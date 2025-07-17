"""
Example of using MCPAgent with remote agent initialization.

This script demonstrates how to create and use a remote agent with
automatic initialization and beautiful terminal formatting.
"""

import asyncio

from mcp_use.agents.mcpagent import MCPAgent


async def main():
    """Example usage of remote agent with initialization in constructor."""

    # Create a remote agent - initialization happens in constructor
    agent = MCPAgent(
        agent_id="eaf948d8-a70b-4b45-8c9e-4132a9caf7b7",
        remote_agent_title="Chat with Web Search",
        auto_initialize=True,  # Initialize immediately
        memory_enabled=True,  # Keep conversation history
        verbose=True,
    )

    # The agent is automatically initialized, so we can run queries immediately
    query = "What are the current trends in AI and machine learning for 2024?"

    print("🚀 Running remote agent query...")

    # Stream the response with beautiful formatting
    async for result in agent.run(query):
        # The final result is yielded at the end
        print(f"\n✅ Final result received: {len(result)} characters")

    # Run another query to demonstrate conversation memory
    follow_up = "Can you create some actionable goals based on those trends?"

    print("\n🔄 Running follow-up query...")

    async for result in agent.run(follow_up):
        print(f"\n✅ Follow-up result received: {len(result)} characters")


if __name__ == "__main__":
    # Run the example
    asyncio.run(main())
