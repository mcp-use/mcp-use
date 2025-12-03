# mcp_use/adapters/__init__.py
import warnings

from typing_extensions import deprecated

from mcp_use.agents.adapters import BaseAdapter as _BaseAdapter
from mcp_use.agents.adapters import LangChainAdapter as _LangChainAdapter

warnings.warn(
    "mcp_use.adapters is deprecated. Use mcp_use.agents.adapters. This import will be removed in version 2.0.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.agents.adapters.BaseAdapter")
class BaseAdapter(_BaseAdapter): ...


@deprecated("Use mcp_use.agents.adapters.LangChainAdapter")
class LangChainAdapter(_LangChainAdapter): ...
