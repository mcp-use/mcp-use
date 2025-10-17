# mcp_use/task_managers/sse.py
from typing_extensions import deprecated

from mcp_use.client.task_managers.sse import SseConnectionManager as _SseConnectionManager


@deprecated("Use mcp_use.client.task_managers.sse.SseConnectionManager")
class SseConnectionManager(_SseConnectionManager): ...
