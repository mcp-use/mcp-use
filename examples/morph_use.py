import asyncio
import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient


async def run_morph_example():
    """Run Morph Fast Apply MCP with GPT-4o using injected config."""
    load_dotenv()

    # Load environment variables
    morph_api_key = os.getenv("MORPH_API_KEY")
    all_tools = os.getenv("ALL_TOOLS", "false")

    if not morph_api_key:
        raise OSError("MORPH_API_KEY is not set in your environment or .env file.")

    # Define Morph MCP config with injected env
    config = {
        "mcpServers": {
            "morph": {
                "command": "npx",
                "args": ["@morph-llm/morph-fast-apply"],
                "env": {"MORPH_API_KEY": morph_api_key, "ALL_TOOLS": all_tools},
            }
        }
    }

    # Instantiate MCPClient directly
    client = MCPClient(config=config)

    # Use GPT-4o via OpenAI
    llm = ChatOpenAI(model="gpt-4o")

    agent = MCPAgent(llm=llm, client=client, max_steps=30)

    try:
        result = await agent.run(
            "Read the CSV file at 'data/sentiment_dataset.csv'. The label column is 'sentiment'. "
            "Use Morph to train a classification model and print the model's accuracy.",
            max_steps=30,
        )
        print(f"\nResult:\n{result}")
    finally:
        if client.sessions:
            await client.close_all_sessions()


if __name__ == "__main__":
    asyncio.run(run_morph_example())
