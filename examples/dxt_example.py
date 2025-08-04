"""
Example of using DXT (Desktop Extension) files with MCP-Use.

This example demonstrates how to load and use an MCP server from a .dxt file,
which is Anthropic's one-click installation format for MCP servers.
"""

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

from mcp_use import MCPAgent, MCPClient


async def main():
    """Run the DXT example."""
    # Load environment variables
    load_dotenv()

    # Example 1: Load a DXT file using from_config_file (automatic detection)
    # This works because from_config_file now detects .dxt extension
    client = MCPClient.from_config_file("example.dxt")

    # Example 2: Load a DXT file using the dedicated from_dxt method
    # This is more explicit and recommended when you know you're loading a DXT
    # client = MCPClient.from_dxt("example.dxt")

    # Example 3: Load a DXT with sandbox options for secure execution
    # from mcp_use.types.sandbox import SandboxOptions
    # sandbox_options: SandboxOptions = {
    #     "api_key": os.getenv("E2B_API_KEY"),
    #     "sandbox_template_id": "base",
    # }
    # client = MCPClient.from_dxt(
    #     "example.dxt",
    #     sandbox=True,
    #     sandbox_options=sandbox_options
    # )

    # Create LLM
    llm = ChatOpenAI(model="gpt-4o")

    # Create agent with the client
    agent = MCPAgent(llm=llm, client=client, max_steps=30)

    try:
        # Run a query using the tools from the DXT-packaged server
        result = await agent.run(
            "Use the available tools to help me with my task",
            max_steps=30,
        )
        print(f"\nResult: {result}")
    finally:
        # Clean up sessions
        await client.close_all_sessions()

        # Note: The DXT loader extracts files to a temporary directory
        # This directory is automatically cleaned up when the program exits
        # but you can access it via client.config["_dxt_metadata"]["temp_dir"]
        # if you need to inspect the extracted files


if __name__ == "__main__":
    # Note: To run this example, you'll need a .dxt file
    # You can get DXT files from:
    # - https://github.com/anthropics/dxt/tree/main/examples
    # - Or create your own by packaging an MCP server following the DXT spec

    print("This example requires a .dxt file to run.")
    print("Please ensure you have a valid .dxt file in the current directory.")
    print("You can find example DXT files at: https://github.com/anthropics/dxt")

    # Uncomment the line below when you have a .dxt file
    # asyncio.run(main())
