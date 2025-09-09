"""MCP-related type definitions."""

from typing import TypedDict

from mcp.types import Prompt, Resource, Tool


class ServerCapability(TypedDict):
    """Type definition for server capabilities.

    Attributes:
        tools: List of available tools from the server
        resources: List of available resources from the server
        prompts: List of available prompts from the server
    """

    tools: list[Tool]
    resources: list[Resource]
    prompts: list[Prompt]
