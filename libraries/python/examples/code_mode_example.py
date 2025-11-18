"""
Code Mode Example - Using MCP Tools via Code Execution

This example demonstrates how AI agents can use MCP tools through code execution mode,
which enables more efficient context usage and data processing compared to
direct tool calls.

Based on Anthropic's research: https://www.anthropic.com/engineering/code-execution-with-mcp
"""

import asyncio

from mcp_use import MCPClient
from mcp_use.client.prompts import CODE_MODE_AGENT_PROMPT

try:
    from langchain_openai import ChatOpenAI

    from mcp_use import MCPAgent

    HAS_LANGCHAIN = True
except ImportError:
    HAS_LANGCHAIN = False
    MCPAgent = None  # type: ignore
    ChatOpenAI = None  # type: ignore

# Example configuration with a simple MCP server
# You can replace this with your own server configuration
config = {
    "mcpServers": {
        "filesystem": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-filesystem", "/private/tmp"],
        }
    }
}


async def example_1_tool_discovery():
    """Example 1: Discovering available tools."""
    print("\n=== Example 1: Tool Discovery ===\n")

    client = MCPClient(config=config, code_mode=True)
    await client.create_all_sessions()

    try:
        # Search for all available tools
        result = await client.execute_code("""
# Search for all tools
all_tools = await search_tools()
print(f"Total tools available: {len(all_tools)}")

# Show tools organized by server
tools_by_server = {}
for tool in all_tools:
    server = tool['server']
    if server not in tools_by_server:
        tools_by_server[server] = []
    tools_by_server[server].append(tool['name'])

for server, tools in tools_by_server.items():
    print(f"\\n{server} server:")
    for tool_name in tools:
        print(f"  - {tool_name}")

return {"total": len(all_tools), "servers": list(tools_by_server.keys())}
""")

        print(f"\nResult: {result['result']}")
        print(f"Execution time: {result['execution_time']:.2f}s")
        print("\nLogs:")
        for log in result["logs"]:
            print(f"  {log}")

    finally:
        await client.close_all_sessions()


async def example_2_efficient_data_processing():
    """Example 2: Processing data efficiently in execution environment."""
    print("\n=== Example 2: Efficient Data Processing ===\n")

    client = MCPClient(config=config, code_mode=True)
    await client.create_all_sessions()

    try:
        # Create some test files and process them
        result = await client.execute_code(
            """
# List directory contents (returns formatted string)
try:
    files_str = await filesystem.list_directory(path="/private/tmp")
    print(f"Raw output length: {len(files_str)} chars")

    # Parse the formatted string output
    lines = files_str.strip().split('\\n')
    directories = [line for line in lines if line.startswith('[DIR]')]
    regular_files = [line for line in lines if line.startswith('[FILE]')]

    print(f"Directories: {len(directories)}")
    print(f"Files: {len(regular_files)}")
    print(f"Total items: {len(lines)}")

    # Return only summary
    return {
        "total_items": len(lines),
        "directories": len(directories),
        "files": len(regular_files),
        "sample_dirs": [d.replace('[DIR] ', '') for d in directories[:3]],
        "sample_files": [f.replace('[FILE] ', '') for f in regular_files[:3]]
    }
except Exception as e:
    print(f"Error: {e}")
    return {"error": str(e)}
""",
            timeout=10.0,
        )

        print(f"\nResult: {result['result']}")
        print(f"Execution time: {result['execution_time']:.2f}s")

        if result["error"]:
            print(f"\nError occurred: {result['error']}")

        print("\nLogs:")
        for log in result["logs"]:
            print(f"  {log}")

    finally:
        await client.close_all_sessions()


async def example_3_tool_chaining():
    """Example 3: Chaining multiple tool calls in one execution."""
    print("\n=== Example 3: Tool Chaining ===\n")

    client = MCPClient(config=config, code_mode=True)
    await client.create_all_sessions()

    try:
        # Chain multiple operations
        result = await client.execute_code("""
# Discover what tools are available
tools = await search_tools("", detail_level="names")
print(f"Available tools: {[t['name'] for t in tools]}")

# Check available namespaces
print(f"Available servers: {__tool_namespaces}")

# Example workflow (adapt based on your MCP servers)
workflow_results = []

for namespace in __tool_namespaces:
    workflow_results.append({
        "server": namespace,
        "status": "connected"
    })

return {
    "servers_connected": len(__tool_namespaces),
    "workflow_results": workflow_results
}
""")

        print(f"\nResult: {result['result']}")
        print(f"Execution time: {result['execution_time']:.2f}s")
        print("\nLogs:")
        for log in result["logs"]:
            print(f"  {log}")

    finally:
        await client.close_all_sessions()


async def example_4_error_handling():
    """Example 4: Error handling in code execution."""
    print("\n=== Example 4: Error Handling ===\n")

    client = MCPClient(config=config, code_mode=True)
    await client.create_all_sessions()

    try:
        result = await client.execute_code("""
results = []

try:
    # Try to call a tool (might fail if not available)
    tools = await search_tools("nonexistent")
    print(f"Found {len(tools)} tools matching 'nonexistent'")
    results.append({"search": "success", "count": len(tools)})
except Exception as e:
    print(f"Search failed: {e}")
    results.append({"search": "failed", "error": str(e)})

# Continue with other operations
try:
    all_tools = await search_tools()
    print(f"Total tools: {len(all_tools)}")
    results.append({"total_tools": len(all_tools)})
except Exception as e:
    print(f"Failed to get all tools: {e}")
    results.append({"error": str(e)})

return {"results": results, "success": True}
""")

        print(f"\nResult: {result['result']}")
        print(f"Execution time: {result['execution_time']:.2f}s")

        if result["error"]:
            print(f"\nExecution error: {result['error']}")

        print("\nLogs:")
        for log in result["logs"]:
            print(f"  {log}")

    finally:
        await client.close_all_sessions()


async def example_5_agent_with_code_mode():
    """Example 5: AI Agent using code mode (requires OpenAI API key)."""
    print("\n=== Example 5: AI Agent with Code Mode ===\n")

    if not HAS_LANGCHAIN:
        print("⚠️  Skipping: langchain-openai not installed")
        print("   Install with: pip install langchain-openai")
        return

    client = MCPClient(config=config, code_mode=True)

    # Create LLM
    llm = ChatOpenAI(model="gpt-4", temperature=0)

    # Create agent with code mode instructions
    system_prompt = f"""You are an AI assistant with access to MCP tools via code execution.

{CODE_MODE_AGENT_PROMPT}

When the user asks you to perform tasks, write Python code that:
1. Discovers available tools using search_tools()
2. Calls the appropriate tools as async functions
3. Processes data efficiently in the execution environment
4. Returns only essential results

Always explain what you're doing before executing code.
"""

    agent = MCPAgent(llm=llm, client=client, system_prompt=system_prompt, max_steps=10)

    try:
        print("Agent initialized with code mode enabled!\n")
        print("The agent will use execute_code() to interact with MCP tools.\n")

        # Example query
        query = """List all available MCP tools and tell me which server they belong to. Please tell me the list of
        files in the current folder."""

        print(f"Query: {query}\n")
        print("Agent response:")
        print("-" * 60)

        result = await agent.run(query)

        print(result)
        print("-" * 60)

        print("\n✅ Agent successfully used code mode to interact with tools!")
        print("   The agent wrote and executed Python code instead of calling tools directly.")

    finally:
        await client.close_all_sessions()


async def main():
    """Run all examples."""
    print("=" * 60)
    print("MCP Code Mode Examples")
    print("=" * 60)
    print("\nThese examples demonstrate how AI agents can use MCP tools")
    print("via code execution, which reduces context consumption by up to 98.7%.")
    print("\nNote: Examples use the filesystem MCP server. You can adapt")
    print("the configuration to use your own MCP servers.")
    print("=" * 60)

    # Run examples
    print("\n🔧 Basic Code Mode Examples (Direct Client Usage)")
    print("-" * 60)
    # await example_1_tool_discovery()
    # await example_2_efficient_data_processing()
    # await example_3_tool_chaining()
    # await example_4_error_handling()

    print("\n\n🤖 AI Agent Examples (Agent + Code Mode)")
    print("-" * 60)
    await example_5_agent_with_code_mode()

    print("\n" + "=" * 60)
    print("Examples completed!")
    print("=" * 60)

    print("\n\n💡 Key Takeaways:")
    print("-" * 60)
    print("1. Code mode reduces context usage by up to 98.7%")
    print("2. Agents write Python code to interact with tools")
    print("3. Data processing happens in execution environment")
    print("4. Only essential results are returned to the agent")
    print("5. Tools are discovered progressively as needed")

    print("\n\n📚 Agent Prompt Template:")
    print("-" * 60)
    print("Use CODE_MODE_AGENT_PROMPT from mcp_use.client.prompts")
    print("to provide code mode instructions to your AI agent.")
    print("\nExample:")
    print("  from mcp_use import CODE_MODE_AGENT_PROMPT")
    print("  system_prompt = f'{CODE_MODE_AGENT_PROMPT}\\n\\nAdditional instructions...'")


if __name__ == "__main__":
    asyncio.run(main())
