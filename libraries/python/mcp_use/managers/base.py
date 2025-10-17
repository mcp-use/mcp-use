# mcp_use/managers/base.py
from typing_extensions import deprecated

from mcp_use.agents.managers.base import BaseServerManager as _BaseServerManager


@deprecated("Use mcp_use.agents.managers.base.BaseServerManager")
class BaseServerManager(_BaseServerManager): ...
