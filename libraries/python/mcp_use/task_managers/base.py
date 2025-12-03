# mcp_use/task_managers/base.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.task_managers.base import ConnectionManager as _ConnectionManager

warnings.warn(
    "mcp_use.task_managers.base is deprecated. "
    "Use mcp_use.client.task_managers.base. "
    "This import will be removed in version 2.0.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.task_managers.base.ConnectionManager")
class ConnectionManager(_ConnectionManager): ...
