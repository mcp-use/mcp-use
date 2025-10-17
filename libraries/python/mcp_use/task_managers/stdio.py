# mcp_use/task_managers/stdio.py
from typing_extensions import deprecated

from mcp_use.client.task_managers.stdio import StdioConnectionManager as _StdioConnectionManager


@deprecated("Use mcp_use.client.task_managers.stdio.StdioConnectionManager")
class StdioConnectionManager(_StdioConnectionManager): ...
