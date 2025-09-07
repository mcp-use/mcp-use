"""
Example usage of the MCPReActAgent - a ReAct agent implementation without LangChain.
"""

import asyncio
import os

from dotenv import load_dotenv

from mcp_use.agents.mcp_react_agent import MCPReActAgent, StepType
from mcp_use.client import MCPClient

# Configure the everything server like in mcp_everything.py
everything_server = {
    "mcpServers": {"everything": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-everything"]}}
}


async def main():
    """Run example with the ReAct agent using server-everything."""
    # Load environment variables
    load_dotenv()

    # Example 1: Using with MCPClient and server-everything
    print("=" * 60)
    print("Example 1: ReAct Agent with MCP Everything Server")
    print("=" * 60)

    # Create MCP client with everything server config
    mcp_client = MCPClient(config=everything_server)

    # Create ReAct agent
    agent = MCPReActAgent(
        model_name="gpt-4o-mini",
        model_api_key=os.getenv("OPENAI_API_KEY"),
        client=mcp_client,
        max_steps=5,
        verbose=True,
        memory_enabled=True,
    )

    # Initialize the agent
    await agent.initialize()

    # Example query to test the everything server capabilities
    query = """
    Hello, you are a tester. Can you please answer the following questions:
    - Which resources do you have access to?
    - Which prompts do you have access to?
    - Which tools do you have access to?
    """

    print(f"\n📝 Query: {query}\n")

    # Run the agent
    result = await agent.run(query)

    print(f"\n✅ Final Result: {result}\n")

    # Example 2: Streaming execution
    print("=" * 60)
    print("Example 2: Streaming ReAct Execution")
    print("=" * 60)

    query2 = "Can you demonstrate using one of your available tools?"
    print(f"\n📝 Query: {query2}\n")

    # Stream the execution
    async for step_type, content in agent.stream(query2):
        if step_type == StepType.THOUGHT:
            print(f"💭 Thought: {content}")
        elif step_type == StepType.ACTION:
            print(f"🔧 Action: {content}")
        elif step_type == StepType.OBSERVATION:
            print(f"👁️ Observation: {content[:200]}..." if len(content) > 200 else f"👁️ Observation: {content}")
        elif step_type == StepType.FINAL_ANSWER:
            print(f"✅ Final Answer: {content}")

    # Example 3: With conversation memory
    print("\n" + "=" * 60)
    print("Example 3: Conversation with Memory")
    print("=" * 60)

    # The agent remembers previous context
    query3 = "Based on what you've shown me, what other capabilities do you have?"
    print(f"\n📝 Follow-up Query: {query3}\n")

    result3 = await agent.run(query3)
    print(f"✅ Result: {result3}\n")

    # Show conversation history
    history = agent.get_conversation_history()
    print(f"📚 Conversation history has {len(history)} messages")

    # Close the agent
    await agent.close()


async def example_with_structured_output():
    """Example using structured output with Pydantic models and server-everything."""
    from pydantic import BaseModel, Field

    load_dotenv()

    class ToolInfo(BaseModel):
        """Information about available tools."""

        tool_count: int = Field(description="Total number of tools available")
        tool_names: list[str] = Field(description="Names of all available tools")
        resource_count: int = Field(description="Number of resources available")
        prompt_count: int = Field(description="Number of prompts available")

    print("=" * 60)
    print("Example 4: Structured Output with ReAct and Everything Server")
    print("=" * 60)

    # Create MCP client with everything server
    mcp_client = MCPClient(config=everything_server)

    # Create agent
    agent = MCPReActAgent(
        model_name="gpt-4o-mini",
        model_api_key=os.getenv("OPENAI_API_KEY"),
        client=mcp_client,
        max_steps=5,
        verbose=False,
    )

    # Initialize the agent
    await agent.initialize()

    query = "Analyze all available tools, resources, and prompts. Provide a structured summary."
    print(f"\n📝 Query: {query}\n")

    # This would return a ToolInfo instance
    # Note: Uncomment when testing with actual structured output support
    # result: ToolInfo = await agent.run(query, output_schema=ToolInfo)
    # print(f"Total tools: {result.tool_count}")
    # print(f"Tool names: {result.tool_names}")
    # print(f"Resources: {result.resource_count}")
    # print(f"Prompts: {result.prompt_count}")

    await agent.close()


if __name__ == "__main__":
    # Run the main example
    asyncio.run(main())

    # Uncomment to run structured output example
    # asyncio.run(example_with_structured_output())
