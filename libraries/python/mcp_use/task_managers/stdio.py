# mcp_use/task_managers/stdio.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.task_managers.stdio import StdioConnectionManager as _StdioConnectionManager

warnings.warn(
    "mcp_use.task_managers.stdio is deprecated. "
    "Use mcp_use.client.task_managers.stdio. "
    "This import will be removed in version 1.4.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.task_managers.stdio.StdioConnectionManager")
class StdioConnectionManager(_StdioConnectionManager): ...
