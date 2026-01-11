# mcp_use/task_managers/streamable_http.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.task_managers.streamable_http import (
    StreamableHttpConnectionManager as _StreamableHttpConnectionManager,
)

warnings.warn(
    "mcp_use.task_managers.streamable_http is deprecated. "
    "Use mcp_use.client.task_managers.streamable_http. "
    "This import will be removed in version 2.0.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.task_managers.streamable_http.StreamableHttpConnectionManager")
class StreamableHttpConnectionManager(_StreamableHttpConnectionManager): ...
