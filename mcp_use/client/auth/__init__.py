"""Authentication support for MCP clients."""

from .bearer import BearerAuth
from .oauth import OAuth

__all__ = ["BearerAuth", "OAuth"]
