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
            "airbnb": {"command": "npx", "args": ["-y", "@openbnb/mcp-server-airbnb", "--ignore-robots-txt"]}
        }
    }

    try:
        client = MCPClient(config=config)

        # Creates the adapter for OpenAI's format
        adapter = OpenAIMCPAdapter()

        # Convert tools from active connectors to the OpenAI's format
        openai_tools = await adapter.create_tools(client)

        # Use tools with OpenAI's SDK (not agent in this case)
        openai = OpenAI()
        input_list = [{"role": "user", "content": "Search on Airbnb the cheapest hotel in Trapani for two nights."}]
        response = openai.chat.completions.create(model="gpt-4o", messages=input_list, tools=openai_tools)

        response_message = response.choices[0].message
        input_list.append(response_message)
        if not response_message.tool_calls:
            print("No tool call requested by the model")
            print(response_message.content)
            return

        for tool_call in response_message.tool_calls:
            import json

            function_name = tool_call.function.name
            arguments = json.loads(tool_call.function.arguments)

            # Use the adapter's map to get the correct connector
            connector = adapter.tool_to_connector_map[function_name]

            print(f"Executing tool: {function_name}({arguments})")
            tool_result = await connector.call_tool(name=function_name, arguments=arguments)

        # Handle and print the result
        if getattr(tool_result, "isError", False):
            print(f"Error: {tool_result.content}")
            return

        input_list.append(
            {"tool_call_id": tool_call.id, "role": "tool", "name": function_name, "content": tool_result.content}
        )

        # Send the tool result back to the model
        second_response = openai.chat.completions.create(model="gpt-4o", messages=input_list, tools=openai_tools)
        final_message = second_response.choices[0].message
        print("\n--- Final response from the model ---")
        print(final_message.content)

    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    asyncio.run(main())
