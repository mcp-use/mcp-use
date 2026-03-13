"""
Connector auto-infer factory.

Provides a convenience factory that creates the appropriate connector type
based on the provided arguments, enabling ergonomic usage:

    from mcp_use import Connector

    http = Connector(url="https://api.example.com/mcp")
    stdio = Connector(command="npx", args=["@playwright/mcp"])
"""

from __future__ import annotations

from typing import Any

from mcp_use.client.connectors.base import BaseConnector


def Connector(  # noqa: N802 — intentionally PascalCase to act as a class-like factory
    *,
    url: str | None = None,
    command: str | None = None,
    **kwargs: Any,
) -> BaseConnector:
    """Create the appropriate connector based on the provided arguments.

    This factory auto-infers the connector type:
    - If ``url`` is provided, returns an :class:`HttpConnector`.
    - If ``command`` is provided, returns a :class:`StdioConnector`.

    Args:
        url: The URL for an HTTP-based MCP server.
        command: The command for a stdio-based MCP server.
        **kwargs: Additional keyword arguments forwarded to the chosen connector.

    Returns:
        An instance of the inferred connector type.

    Raises:
        ValueError: If neither ``url`` nor ``command`` is provided.
    """
    if url is not None:
        from mcp_use.client.connectors.http import HttpConnector

        return HttpConnector(base_url=url, **kwargs)

    if command is not None:
        from mcp_use.client.connectors.stdio import StdioConnector

        return StdioConnector(command=command, **kwargs)

    raise ValueError(
        "Cannot infer connector type: provide either 'url' (for HttpConnector) or 'command' (for StdioConnector)."
    )
