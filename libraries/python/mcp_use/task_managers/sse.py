# mcp_use/task_managers/sse.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.task_managers.sse import SseConnectionManager as _SseConnectionManager

warnings.warn(
    "mcp_use.task_managers.sse is deprecated. "
    "Use mcp_use.client.task_managers.sse. "
    "This import will be removed in version 2.0.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.task_managers.sse.SseConnectionManager")
class SseConnectionManager(_SseConnectionManager): ...
