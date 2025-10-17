# mcp_use/task_managers/base.py
from typing_extensions import deprecated

from mcp_use.client.task_managers.base import ConnectionManager as _ConnectionManager


@deprecated("Use mcp_use.client.task_managers.base.ConnectionManager")
class ConnectionManager(_ConnectionManager): ...
