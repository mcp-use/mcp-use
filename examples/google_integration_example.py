import asyncio

from dotenv import load_dotenv
from google import genai
from google.genai import types

from mcp_use import MCPClient
from mcp_use.adapters import GoogleMCPAdapter

# This example demonstrates how to use our integration
# adapaters to use MCP tools and convert to the right format.
# In particularly, this example uses the GoogleMCPAdapter.

load_dotenv()


async def main():
    config = {
        "mcpServers": {"playwright": {"command": "npx", "args": ["@playwright/mcp@latest"], "env": {"DISPLAY": ":1"}}}
    }

    try:
        client = MCPClient(config=config)

        # Creates the adapter for Anthropic's format
        adapter = GoogleMCPAdapter()

        # Convert tools from active connectors to the Anthropic's format
        await adapter.create_all(client)

        # The adapter returns a list of Tool objects, each with one function.
        # We need to collect all function declarations into a single Tool object.
        all_tools = adapter.tools + adapter.resources + adapter.prompts
        all_function_declarations = []
        for tool in all_tools:
            if tool:  # Adapter methods can return None for disallowed tools
                all_function_declarations.extend(tool.function_declarations)

        google_tools = [types.Tool(function_declarations=all_function_declarations)]

        # If you don't want to create all tools, you can call single functions
        # await adapter.create_tools(client)
        # await adapter.create_resources(client)
        # await adapter.create_prompts(client)

        # Use tools with Google's SDK (not agent in this case)
        client = genai.Client()

        messages = [
            types.Content(
                role="user",
                parts=[
                    types.Part.from_text(
                        text="Please search on the internet using browser: 'What time is it in UK now!'"
                    )
                ],
            )
        ]
        # Initial request
        response = client.models.generate_content(
            model="gemini-flash-lite-latest", contents=messages, config=types.GenerateContentConfig(tools=google_tools)
        )

        if not response.function_calls:
            print("The model didn't do any tool call!")
            return

        while response.function_calls:
            for function_call in response.function_calls:
                function_call_content = response.candidates[0].content

                messages.append(function_call_content)

                tool_name = function_call.name
                arguments = function_call.args

                # Use the adapter's map to get the correct executor
                executor = adapter.tool_executors[tool_name]

                if not executor:
                    print(f"Error: Unknown tool '{tool_name}' requested by model.")
                    function_response_content = types.Content(
                        role="tool",
                        parts=[
                            types.Part.from_function_response(
                                name=tool_name,
                                response={"error": "No executor found for the tool requested"},
                            )
                        ],
                    )
                else:
                    try:
                        # Execute the tool using the retrieved function
                        print(f"Executing tool: {tool_name}({arguments})")
                        tool_result = await executor(**arguments)

                        # Use the adapter's universal parser
                        content = adapter.parse_result(tool_result)
                        function_response = {"result": content}

                        function_response_part = types.Part.from_function_response(
                            name=tool_name,
                            response=function_response,
                        )
                        function_response_content = types.Content(role="tool", parts=[function_response_part])
                    except Exception as e:
                        print(f"An unexpected error occurred while executing tool {tool_name}: {e}")
                        function_response_content = types.Content(
                            role="tool",
                            parts=[
                                types.Part.from_function_response(
                                    name=tool_name,
                                    response={"error": str(e)},
                                )
                            ],
                        )
                # Append the tool's result to the conversation history
                messages.append(function_response_content)
                # Send the tool's result back to the model to get the next response

            response = client.models.generate_content(
                model="gemini-flash-lite-latest",
                contents=messages,
                config=types.GenerateContentConfig(tools=google_tools),
            )
        # Get final response, the loop has finished

        print("\n--- Final response from the model ---")
        if response.text:
            print(response.text)
        else:
            print("The model did not return a final text response.")
            print(response)

        client.close()
    except Exception as e:
        print(f"Error: {e}")
        client.close()
        raise e


if __name__ == "__main__":
    asyncio.run(main())
