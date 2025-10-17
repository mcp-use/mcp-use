# mcp_use/adapters/base.py
from typing_extensions import deprecated

from mcp_use.agents.adapters.base import BaseAdapter as _BaseAdapter


@deprecated("Use mcp_use.agents.adapters.base.BaseAdapter")
class BaseAdapter(_BaseAdapter): ...
