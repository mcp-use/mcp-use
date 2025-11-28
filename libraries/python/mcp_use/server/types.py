"""Shared transport-related typing helpers."""

from typing import Literal

TransportType = Literal["stdio", "streamable-http"]

__all__ = ["TransportType"]
