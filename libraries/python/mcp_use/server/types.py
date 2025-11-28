"""Shared transport-related typing helpers."""

from typing import Literal

# Main supported transports per MCP Protocol 2025-06-18
# "sse" is kept for backwards compatibility but is deprecated (Protocol 2024-11-05)
TransportType = Literal["stdio", "streamable-http", "sse"]

__all__ = ["TransportType"]
