"""Type definitions for sandbox-related configurations."""

from typing import NotRequired, TypedDict


class SandboxOptions(TypedDict):
    """Configuration options for sandbox execution.

    This type defines the configuration options available when running
    MCP servers in a sandboxed environment (e.g., using E2B).
    """

    api_key: str
    """Direct API key for sandbox provider (e.g., E2B API key).
    If not provided, will use E2B_API_KEY environment variable."""

    sandbox_template_id: NotRequired[str]
    """Template ID for the sandbox environment.
    Default: 'base'"""

    supergateway_command: NotRequired[str]
    """Command to run supergateway.
    Default: 'npx -y supergateway'"""
