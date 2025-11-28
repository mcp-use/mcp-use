"""Shared transport-related typing helpers."""

from typing import Literal

TransportType = Literal["stdio", "streamable-http", "sse"]

__all__ = ["TransportType"]
