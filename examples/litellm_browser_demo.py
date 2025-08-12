"""
This demo shows how to implement mcp-use with Litellm.
It uses the LitellmAdapter class to convert MCP tools to OpenAI tools.
It uses the LitellmMCPAgent class to run the agent.
"""
import asyncio

from dotenv import load_dotenv
from typing import Any, List

from langchain_core.language_models import BaseLanguageModel
from mcp import Tool

from mcp_use.adapters.base import BaseAdapter
from mcp_use.client import MCPClient
from mcp_use.connectors.base import BaseConnector

from litellm import acompletion

class LitellmAdapter(BaseAdapter):
    """
    This class is used to convert MCP tools to OpenAI tools.
    """

    def __init__(self, disallowed_tools: List[str] | None = None):
        super().__init__(disallowed_tools)

    def fix_schema(self, schema: dict) -> dict:
        """Convert JSON Schema 'type': ['string', 'null'] to 'anyOf' format.

        Args:
            schema: The JSON schema to fix.

        Returns:
            The fixed JSON schema.
        """
        if isinstance(schema, dict):
            if "type" in schema and isinstance(schema["type"], list):
                schema["anyOf"] = [{"type": t} for t in schema["type"]]
                del schema["type"]  # Remove 'type' and standardize to 'anyOf'
            for key, value in schema.items():
                schema[key] = self.fix_schema(value)  # Apply recursively
        return schema
    
    def _convert_tool(self, mcp_tool: Tool, connector: BaseConnector) -> dict[str, Any]:
        """Convert an MCP tool to OpenAI tool format.

        Args:
            mcp_tool: The MCP tool to convert.
            connector: The connector that provides this tool.

        Returns:
            The converted tool.
        """
        if mcp_tool.name in self.disallowed_tools:
            return None
        
        fixed_schema = self.fix_schema(mcp_tool.inputSchema)

        openai_tool = {
            "type": "function",
            "function": {
                "name": mcp_tool.name,
                "description": mcp_tool.description,
                "parameters": fixed_schema,
            }
        }

        return openai_tool
    
    def _convert_resource(self, mcp_resource: dict[str, Any], connector: BaseConnector) -> dict[str, Any]:
        pass
    
    def _convert_prompt(self, mcp_prompt: dict[str, Any], connector: BaseConnector) -> dict[str, Any]:
        pass

class LitellmMCPAgent():
    """
    This class is used to run the agent.
    """

    def __init__(self, model: str, client: MCPClient, disallowed_tools: List[str] | None = None, system_prompt: str | None = None):

        if model is None:
            raise ValueError("LLM is required for execution.")
        if not client:
            raise ValueError("MCP client is required for execution.")

        self.model = model
        self.client = client
        self.adapter = LitellmAdapter(disallowed_tools=disallowed_tools)
        self.system_prompt = system_prompt
        self._tools = List[dict[str, Any]]
    
    async def initialize(self):
        """
        Initialize the agent, create tools and sessions.
        """
        # It follows a bit the MCPAgent pattern, but it's not exactly the same.
        self._sessions = self.client.get_all_active_sessions()
        print(f"Found {len(self._sessions)} existing sessions")

        if not self._sessions:
            print("No existing sessions found, creating new session")
            self._sessions = await self.client.create_all_sessions()
            self._connectors = [session.connector for session in self._sessions.values()]
            print(f"Created {len(self._sessions)} new sessions")
        
        self._tools = await self.adapter.create_tools(self.client)
        print(f"Created {len(self._tools)} tools")

    async def run(self, query: str):
        """
        Run the agent with the given query.
        """
        messages = [
            {"role": "system", "content": self.system_prompt or "You are a helpful assistant that can use tools to answer questions."},
            {"role": "user", "content": query}
        ]

        response = await acompletion(model=self.model, messages=messages, tools=self._tools, tool_choice="auto")
        if response.choices[0].message.tool_calls:
            print(f"Length of tool calls: {len(response.choices[0].message.tool_calls)}")
            print(f"Decided to call with reason: {response.choices[0].message.content}")

            messages.append(response.choices[0].message) # Add assistant response to messages
            for tool_call in response.choices[0].message.tool_calls:
                tool_name = tool_call.function.name
                tool_args = tool_call.function.arguments
                tool_id = tool_call.id

                tool_result = await self._execute_tool(tool_name, tool_args)
                # Add context of tool call to messages
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_id,
                    "name": tool_name,
                    "content": tool_result
                })
            # Call the model again with the updated messages
            final_response = await acompletion(model=self.model, messages=messages, tools=self._tools, tool_choice="auto")
            return final_response.choices[0].message.content
        else:
            return response.choices[0].message.content # If no tool calls, return directly the final response
    
    async def _execute_tool(self, tool_name: str, tool_args: dict[str, Any]):
        """
        Execute the tool with the given name and arguments.
        """
        import json

        try:
            args = json.loads(tool_args)
            for session in self._sessions.values(): # That's a bit inefficient, we're going to engineer a better solution
                try:
                    result = await session.call_tool(tool_name, args)
                    if result.content and len(result.content) > 0:
                        return result.content[0].text
                    return str(result)
                except:
                    continue
            return f"Error: Tool {tool_name} not found"
        except Exception as e:
            return f"Error: {str(e)}"