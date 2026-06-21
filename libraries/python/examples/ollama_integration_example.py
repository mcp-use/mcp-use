import asyncio
import json

from dotenv import load_dotenv
from openai import OpenAI

from mcp_use import MCPClient
from mcp_use.agents.adapters import OpenAIMCPAdapter

# This example demonstrates how to integrate mcp-use with local LLMs
# running via Ollama. It utilizes the OpenAIMCPAdapter because Ollama's
# API is fully compatible with the OpenAI chat completions format.

load_dotenv()


async def main():
    # Configure MCP servers. We'll use a public filesystem server as an example.
    config = {
        "mcpServers": {
            "filesystem": {
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-filesystem", "./"],
            },
        }
    }

    try:
        # Initialize the MCP Client
        client = MCPClient(config=config)

        # Creates the adapter for OpenAI's format (fully supported by Ollama's /v1 endpoint)
        adapter = OpenAIMCPAdapter()

        # Convert tools from active connectors to the OpenAI's format
        await adapter.create_all(client)
        openai_tools = adapter.tools + adapter.resources + adapter.prompts

        # Initialize the OpenAI client pointed to your local Ollama instance.
        # Ensure you have Ollama running locally (http://localhost:11434)
        # and have pulled a model that supports tool calling (e.g., llama3.1 or mistral).

        ollama_client = OpenAI(
            base_url="http://localhost:11434/v1",
            api_key="ollama",  # Ollama doesn't require a real API key
        )

        messages = [
            {
                "role": "user",
                "content": "List the files in /Users/keshav/mcp-use/",
            }
        ]

        print("Sending initial prompt to Ollama...")
        # Note: Replace 'llama3.1' with whatever local model you have installed.
        response = ollama_client.chat.completions.create(
            model="Jaahas/qwen3.5-uncensored:2b",  # feel free to use any, i had this one already on system
            messages=messages,
            tools=openai_tools,
        )

        response_message = response.choices[0].message
        messages.append(response_message)

        if not response_message.tool_calls:
            print("\n--- Ollama Response ---")
            print(response_message.content)
            return

        # Handle the tool calls requested by the local model
        for tool_call in response_message.tool_calls:
            function_name = tool_call.function.name
            arguments = json.loads(tool_call.function.arguments)

            # Retrieve the tool executor from the adapter
            executor = adapter.tool_executors.get(function_name)

            if not executor:
                print(f"Error: Unknown tool '{function_name}' requested by Ollama.")
                content = f"Error: Tool '{function_name}' not found."
            else:
                try:
                    print(f"Executing tool: {function_name}({arguments})")
                    tool_result = await executor(**arguments)
                    content = adapter.parse_result(tool_result)
                except Exception as e:
                    print(f"Error executing tool {function_name}: {e}")
                    content = f"Error executing tool: {e}"

            # Append the tool call result to the message flow
            messages.append(
                {
                    "tool_call_id": tool_call.id,
                    "role": "tool",
                    "name": function_name,
                    "content": content,
                }
            )

        print("Sending tool execution results back to Ollama...")
        second_response = ollama_client.chat.completions.create(
            model="Jaahas/qwen3.5-uncensored:2b",
            messages=messages,
            tools=openai_tools,
        )
        final_message = second_response.choices[0].message
        print("\n--- Final response from Ollama ---")
        print(final_message.content)

    except Exception as e:
        print(f"Error: {e}")
        print("\nMake sure you have Ollama running locally at http://localhost:11434")
        print("and the 'llama3.1' model is pulled ('ollama pull llama3.1').")


if __name__ == "__main__":
    asyncio.run(main())
