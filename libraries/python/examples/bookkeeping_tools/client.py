import asyncio

from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI

from mcp_use import MCPAgent, MCPClient

load_dotenv()


async def main():
    client = MCPClient({"mcpServers": {"bookkeeping": {"url": "http://localhost:8000/mcp"}}})

    llm = ChatGoogleGenerativeAI(model="gemini-3.1-flash-lite")
    agent = MCPAgent(llm=llm, client=client, max_steps=10)

    result = await agent.run(
        "I have these transactions from last month: "
        "AWS EC2 $840, annual Figma subscription $1440, "
        "Deel contractor payment $3200, Google Ads $2100. "
        "Categorize them and flag any that need my review."
    )
    print(result)


if __name__ == "__main__":
    asyncio.run(main())
