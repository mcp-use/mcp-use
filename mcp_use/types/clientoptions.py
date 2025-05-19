"""
Options for MCP client configuration.

This module provides data classes and type definitions for configuring the MCP client.
"""

from typing import NotRequired, TypedDict

from .sandbox import SandboxOptions


class ClientOptions(TypedDict):
    """Options for configuring the MCP client.

    This class encapsulates all configuration options for the MCPClient,
    making it easier to extend the API without breaking backward compatibility.
    """

    is_sandboxed: NotRequired[bool]
    """Whether to use sandboxed execution mode for running MCP servers."""

    sandbox_options: NotRequired[SandboxOptions]
    """Options for sandbox configuration when is_sandboxed=True."""
