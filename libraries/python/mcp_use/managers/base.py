# mcp_use/managers/base.py
import warnings

from typing_extensions import deprecated

from mcp_use.agents.managers.base import BaseServerManager as _BaseServerManager

warnings.warn(
    "mcp_use.managers.base is deprecated. "
    "Use mcp_use.agents.managers.base. "
    "This import will be removed in version 2.0.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.agents.managers.base.BaseServerManager")
class BaseServerManager(_BaseServerManager): ...
