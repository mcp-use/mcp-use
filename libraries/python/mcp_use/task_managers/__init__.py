# mcp_use/task_managers/__init__.py
from typing_extensions import deprecated

from mcp_use.client.task_managers import (
    ConnectionManager as _ConnectionManager,
)
from mcp_use.client.task_managers import (
    SseConnectionManager as _SseConnectionManager,
)
from mcp_use.client.task_managers import (
    StdioConnectionManager as _StdioConnectionManager,
)
from mcp_use.client.task_managers import (
    StreamableHttpConnectionManager as _StreamableHttpConnectionManager,
)
from mcp_use.client.task_managers import (
    WebSocketConnectionManager as _WebSocketConnectionManager,
)


@deprecated("Use mcp_use.client.task_managers.ConnectionManager")
class ConnectionManager(_ConnectionManager): ...


@deprecated("Use mcp_use.client.task_managers.StdioConnectionManager")
class StdioConnectionManager(_StdioConnectionManager): ...


@deprecated("Use mcp_use.client.task_managers.WebSocketConnectionManager")
class WebSocketConnectionManager(_WebSocketConnectionManager): ...


@deprecated("Use mcp_use.client.task_managers.SseConnectionManager")
class SseConnectionManager(_SseConnectionManager): ...


@deprecated("Use mcp_use.client.task_managers.StreamableHttpConnectionManager")
class StreamableHttpConnectionManager(_StreamableHttpConnectionManager): ...
