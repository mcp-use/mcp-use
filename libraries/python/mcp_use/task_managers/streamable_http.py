# mcp_use/task_managers/streamable_http.py
from typing_extensions import deprecated

from mcp_use.client.task_managers.streamable_http import (
    StreamableHttpConnectionManager as _StreamableHttpConnectionManager,
)


@deprecated("Use mcp_use.client.task_managers.streamable_http.StreamableHttpConnectionManager")
class StreamableHttpConnectionManager(_StreamableHttpConnectionManager): ...
