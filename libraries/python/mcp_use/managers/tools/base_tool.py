# mcp_use/managers/tools/base_tool.py
from typing_extensions import deprecated

from mcp_use.agents.managers.tools.base_tool import MCPServerTool as _MCPServerTool


@deprecated("Use mcp_use.agents.managers.tools.base_tool.MCPServerTool")
class MCPServerTool(_MCPServerTool): ...
