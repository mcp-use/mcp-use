import asyncio

from dotenv import load_dotenv
from openai import OpenAI

from mcp_use import MCPClient
from mcp_use.adapters import OpenAIMCPAdapter

# This example demonstrates how to use our integration
# adapaters to use MCP tools and convert to the right format.
# In particularly, this example uses the OpenAIMCPAdapter.

load_dotenv()


async def main():
    config = {
        "mcpServers": {
            "airbnb": {"command": "npx", "args": ["-y", "@openbnb/mcp-server-airbnb", "--ignore-robots-txt"]},
        }
    }

    try:
        client = MCPClient(config=config)

        # Creates the adapter for OpenAI's format
        adapter = OpenAIMCPAdapter()

        # Convert tools from active connectors to the OpenAI's format
        # this will populates the list of tools, resources and prompts
        await adapter.create_all(client)

        # If you don't want to create all tools, you can call single functions
        # await adapter.create_tools(client)
        # await adapter.create_resources(client)
        # await adapter.create_prompts(client)

        # If you decided to create all tools (list concatenation)
        openai_tools = adapter.tools + adapter.resources + adapter.prompts

        # Use tools with OpenAI's SDK (not agent in this case)
        openai = OpenAI()
        messages = [{"role": "user", "content": "Please tell me the cheapest hotel for two people in Trapani."}]
        response = openai.chat.completions.create(model="gpt-4o", messages=messages, tools=openai_tools)

        response_message = response.choices[0].message
        messages.append(response_message)
        if not response_message.tool_calls:
            print("No tool call requested by the model")
            print(response_message.content)
            return

        # Handle the tool calls (Tools, Resources, Prompts...)
        for tool_call in response_message.tool_calls:
            import json

            function_name = tool_call.function.name
            arguments = json.loads(tool_call.function.arguments)

            # Use the adapter's map to get the correct executor
            executor = adapter.tool_executors[function_name]

            if not executor:
                print(f"Error: Unknown tool '{function_name}' requested by model.")
                content = f"Error: Tool '{function_name}' not found."
            else:
                try:
                    # Execute the tool using the retrieved function
                    print(f"Executing tool: {function_name}({arguments})")
                    tool_result = await executor(**arguments)

                    # Use the adapter's universal parser
                    content = adapter.parse_result(tool_result)
                except Exception as e:
                    print(f"An unexpected error occurred while executing tool {function_name}: {e}")
                    content = f"Error executing tool: {e}"

            # Append the result for this specific tool call
            messages.append({"tool_call_id": tool_call.id, "role": "tool", "name": function_name, "content": content})

        # Send the tool result back to the model
        second_response = openai.chat.completions.create(model="gpt-4o", messages=messages, tools=openai_tools)
        final_message = second_response.choices[0].message
        print("\n--- Final response from the model ---")
        print(final_message.content)

    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    asyncio.run(main())
