import asyncio

from anthropic import Anthropic
from dotenv import load_dotenv

from mcp_use import MCPClient
from mcp_use.agents.adapters import AnthropicMCPAdapter

# This example demonstrates how to use our integration
# adapters to use MCP tools and convert to the right format.
# In particularly, this example uses the AnthropicMCPAdapter.

load_dotenv()


async def main():
    config = {
        "mcpServers": {
            "airbnb": {"command": "npx", "args": ["-y", "@openbnb/mcp-server-airbnb", "--ignore-robots-txt"]},
        }
    }

    try:
        client = MCPClient(config=config)

        # Creates the adapter for Anthropic's format
        adapter = AnthropicMCPAdapter()

        # Convert tools from active connectors to the Anthropic's format
        await adapter.create_all(client)

        # List concatenation (if you loaded all tools)
        anthropic_tools = adapter.tools + adapter.resources + adapter.prompts

        # If you don't want to create all tools, you can call single functions
        # await adapter.create_tools(client)
        # await adapter.create_resources(client)
        # await adapter.create_prompts(client)

        # Use tools with Anthropic's SDK (not agent in this case)
        anthropic = Anthropic()

        # Initial request
        messages = [{"role": "user", "content": "Please tell me the cheapest hotel for two people in Trapani."}]
        response = anthropic.messages.create(
            model="claude-sonnet-4-5", tools=anthropic_tools, max_tokens=1024, messages=messages
        )
        messages.append({"role": response.role, "content": response.content})

        print("Claude wants to use tools:", response.stop_reason == "tool_use")
        print("Number of tool calls:", len([c for c in response.content if c.type == "tool_use"]))

        if response.stop_reason == "tool_use":
            tool_results = []
            for c in response.content:
                if c.type != "tool_use":
                    continue

                tool_name = c.name
                arguments = c.input

                # Use the adapter's map to get the correct executor
                executor = adapter.tool_executors.get(tool_name)

                if not executor:
                    print(f"Error: Unknown tool '{tool_name}' requested by model.")
                    content = f"Error: Tool '{tool_name}' not found."
                else:
                    try:
                        # Execute the tool using the retrieved function
                        print(f"Executing tool: {tool_name}({arguments})")
                        tool_result = await executor(**arguments)

                        # Use the adapter's universal parser
                        content = adapter.parse_result(tool_result)
                    except Exception as e:
                        print(f"An unexpected error occurred while executing tool {tool_name}: {e}")
                        content = f"Error executing tool: {e}"

                # Append the result for this specific tool call
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": c.id,
                        "content": content,
                    }
                )

            if tool_results:
                messages.append(
                    {
                        "role": "user",
                        "content": tool_results,
                    }
                )
                # Get final response
                final_response = anthropic.messages.create(
                    model="claude-sonnet-4-5", max_tokens=1024, tools=anthropic_tools, messages=messages
                )
                print("\n--- Final response from the model ---")
                print(final_response.content[0].text)
            else:
                final_response = response
                print("\n--- Final response from the model ---")
                if final_response.content:
                    print(final_response.content[0].text)

    except Exception as e:
        print(f"Error: {e}")
        raise e


if __name__ == "__main__":
    asyncio.run(main())
