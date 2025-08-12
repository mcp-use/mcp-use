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