"""
Agent implementations for using MCP tools.

This module provides ready-to-use agent implementations
that are pre-configured for using MCP tools.
"""

from .mcpagent import MCPAgent
from .remote import RemoteAgent

__all__ = [
    "MCPAgent",
    "RemoteAgent",
]
