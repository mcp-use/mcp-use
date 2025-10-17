# mcp_use/adapters/__init__.py
from typing_extensions import deprecated

from mcp_use.agents.adapters import BaseAdapter as _BaseAdapter
from mcp_use.agents.adapters import LangChainAdapter as _LangChainAdapter


@deprecated("Use mcp_use.agents.adapters.BaseAdapter")
class BaseAdapter(_BaseAdapter): ...


@deprecated("Use mcp_use.agents.adapters.LangChainAdapter")
class LangChainAdapter(_LangChainAdapter): ...
