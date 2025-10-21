"""
Adapters for converting MCP tools to different frameworks.

This package provides adapters for converting MCP tools to different frameworks.
"""

from .anthropic import AnthropicMCPAdapter
from .base import BaseAdapter
from .langchain_adapter import LangChainAdapter
from .openai import OpenAIMCPAdapter

try:
    from .google import GoogleMCPAdapter

    __all__ = ["BaseAdapter", "LangChainAdapter", "OpenAIMCPAdapter", "AnthropicMCPAdapter", "GoogleMCPAdapter"]
except ImportError:
    __all__ = ["BaseAdapter", "LangChainAdapter", "OpenAIMCPAdapter", "AnthropicMCPAdapter"]
