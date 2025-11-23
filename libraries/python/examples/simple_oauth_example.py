from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient

load_dotenv()

# This example demonstrates OAuth with Dynamic Client Registration (DCR)
# The client will automatically register itself with the Linear MCP server
# No manual client_id configuration required!

# Clean MCP configuration - no auth details in the server config
linear_config = {"mcpServers": {"linear": {"url": "https://mcp.linear.app/sse"}}}


async def main():
    # Create client with OAuth-enabled configuration at the client level
    # Option 1: Dynamic Client Registration (empty dict)
    client = MCPClient(config=linear_config)

    # Option 2: If you already have a registered client_id, you can use it:
    # client = MCPClient(
    #     config=linear_config,
    #     auth={
    #         "client_id": "YOUR_CLIENT_ID",  # Use your pre-registered client ID
    #         "client_secret": "YOUR_SECRET",  # Only if required
    #     }
    # )

    llm = ChatOpenAI(model="gpt-5", temperature=0)
    agent = MCPAgent(llm=llm, client=client, pretty_print=True, max_steps=50)

    response = await agent.run(query="What are my latest linear issues")
    print(response)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
