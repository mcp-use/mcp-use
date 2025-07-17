import asyncio
import os

from mcp_use import MCPAgent


async def main():
    web_search = MCPAgent(
        agent_id="78c75037-e5c8-417f-a41c-af3455b97c5a",
        api_key=os.getenv("MCP_USE_API_KEY"),
    )
    async for result in web_search.run(
        query="Hello! can you give me an overview of the metrics mcp-use had in the last 30 days? In thsi format Metric: Value 1 month ago Value Today Growth. Look for recent news on mcp-use and write a linear ticket called Read latests news on mcp-use."
    ):
        pass


if __name__ == "__main__":
    asyncio.run(main())
