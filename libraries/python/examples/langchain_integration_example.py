import asyncio
from dataclasses import dataclass

from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain.chat_models import init_chat_model

from mcp_use import MCPClient
from mcp_use.agents.adapters import LangChainAdapter

# This example demonstrates how to use our integration
# adapters to use MCP tools and convert to the right format.
# In particularly, this example uses the LangChainAdapter.

load_dotenv()


# We use a dataclass here, but Pydantic models are also supported.
@dataclass
class ResponseFormat:
    """Response schema for the agent."""

    # AirBnb response (available dates, prices, and relevant information)
    relevant_response: str


async def main():
    config = {
        "mcpServers": {
            "airbnb": {
                "command": "npx",
                "args": ["-y", "@openbnb/mcp-server-airbnb", "--ignore-robots-txt"],
            },
        }
    }

    try:
        client = MCPClient(config=config)

        # Creates the adapter for LangChain's format
        adapter = LangChainAdapter()

        # Convert tools from active connectors to the LangChain's format
        await adapter.create_all(client)

        # List concatenation (if you loaded all tools)
        langchain_tools = adapter.tools + adapter.resources + adapter.prompts

        # Create chat model
        model = init_chat_model("gpt-4o-mini", temperature=0.5, timeout=10, max_tokens=1000)
        # Create the LangChain agent
        agent = create_agent(
            model=model,
            tools=langchain_tools,
            system_prompt="You are a helpful assistant",
            response_format=ResponseFormat,
        )

        # Run the agent
        result = await agent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": "Please tell me the cheapest hotel for two people in Trapani.",
                    }
                ]
            }
        )

        print(result["structured_response"])
    except Exception as e:
        print(f"Error: {e}")
        raise e


if __name__ == "__main__":
    asyncio.run(main())
