"""
This example shows how to test the different functionalities of MCPs using the MCP server.
"""

import asyncio

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient

everything_server = {
    "mcpServers": {
        "everything": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-everything"],
        }
    }
}


async def main():
    """Run the example using a configuration file."""
    load_dotenv()
    client = MCPClient(config=everything_server)
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
    agent = MCPAgent(llm=llm, client=client, max_steps=5)

    print("Initializing agent...")
    print(f"Agent: {agent}")

    result = await agent.run(
        """
        Hello, you are a tester, you have access to prompts, resources and tools.
        Can you please test all the tools, prompts, and resources you have access to and return
        the number of successful tests and the number of failed tests?
        For each succesfful test also
        return the return value of the tool. For each failed test, please return the error
        message and the name of the feature that failed. For each resource,
        can you please describe the content it returned? Also for promtps and tools.
        Importantly, can you see the content of the images?
        """,
    )
    print(f"\nResult: {result}")


if __name__ == "__main__":
    # Run the appropriate example
    asyncio.run(main())
