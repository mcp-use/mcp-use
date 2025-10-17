# mcp_use/adapters/base.py
import warnings

from typing_extensions import deprecated

from mcp_use.agents.adapters.base import BaseAdapter as _BaseAdapter

warnings.warn(
    "mcp_use.adapters.base is deprecated. Use mcp_use.agents.adapters.base. "
    "This import will be removed in version 1.4.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.agents.adapters.base.BaseAdapter")
class BaseAdapter(_BaseAdapter): ...
