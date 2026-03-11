"""Authentication support for MCP clients."""

from .api_key import APIKeyAuth
from .basic import BasicAuth
from .bearer import BearerAuth
from .oauth import OAuth

__all__ = ["APIKeyAuth", "BasicAuth", "BearerAuth", "OAuth"]
