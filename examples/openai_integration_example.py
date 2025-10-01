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
        openai_tools = await adapter.create_tools(client)

        # Use tools with OpenAI's SDK (not agent in this case)
        openai = OpenAI()
        input_list = [
            {"role": "user", "content": "Please execute the `assistant_prompt` tool and tell me what it returns."}
        ]
        response = openai.chat.completions.create(model="gpt-4o", messages=input_list, tools=openai_tools)

        response_message = response.choices[0].message
        input_list.append(response_message)
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

                    # Parse the result from any tool type
                    if getattr(tool_result, "isError", False):
                        print(f"Error from tool execution: {tool_result.content}")
                        content = f"Error: {tool_result.content}"
                    elif hasattr(tool_result, "contents"):  # For Resources
                        content = "\n".join(
                            c.decode() if isinstance(c, bytes) else str(c) for c in tool_result.contents
                        )
                    elif hasattr(tool_result, "messages"):  # For Prompts
                        content = "\n".join(str(s) for s in tool_result.messages)
                    else:  # For Tools and other types with a .content attribute
                        content = str(tool_result.content)

                except Exception as e:
                    print(f"An unexpected error occurred while executing tool {function_name}: {e}")
                    content = f"Error executing tool: {e}"

            # 4. Append the result for this specific tool call
            input_list.append({"tool_call_id": tool_call.id, "role": "tool", "name": function_name, "content": content})

        # Send the tool result back to the model
        second_response = openai.chat.completions.create(model="gpt-4o", messages=input_list, tools=openai_tools)
        final_message = second_response.choices[0].message
        print("\n--- Final response from the model ---")
        print(final_message.content)

    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    asyncio.run(main())
