import asyncio
from langchain_openai import ChatOpenAI
from mcp_use import MCPClient, MCPAgent
from pydantic import BaseModel, Field
from dotenv import load_dotenv

load_dotenv()

class StructuredResult(BaseModel):
    """Returns a summary of the output"""
    summary: str = Field(description="The summary of the description of the hotel")
    price: int = Field(description="The price of the hotel")

async def main():
    config = {
        "mcpServers": {
            "airbnb": {
                "command": "npx",
                "args": ["-y", "@openbnb/mcp-server-airbnb", "--ignore-robots-txt"]
            }
        }
    }

    client = MCPClient(config=config)
    llm = ChatOpenAI(model="gpt-5")

    agent = MCPAgent(llm=llm, client=client, max_steps=30)
    result = await agent.run("Find me a nice place to stay in Trapani for 2 adults "
        "for a week in August (choose a random week). I prefer places with a pool and "
        "good reviews. Show me the first option.", output_schema=StructuredResult)

    print(result)


if __name__ == "__main__":
    asyncio.run(main())