# mcp_use/managers/tools/search_tools.py
from typing_extensions import deprecated

from mcp_use.agents.managers.tools.search_tools import (
    SearchToolsTool as _SearchToolsTool,
)
from mcp_use.agents.managers.tools.search_tools import (
    ToolSearchEngine as _ToolSearchEngine,
)
from mcp_use.agents.managers.tools.search_tools import (
    ToolSearchInput as _ToolSearchInput,
)


@deprecated("Use mcp_use.agents.managers.tools.search_tools.SearchToolsTool")
class SearchToolsTool(_SearchToolsTool): ...


@deprecated("Use mcp_use.agents.managers.tools.search_tools.ToolSearchEngine")
class ToolSearchEngine(_ToolSearchEngine): ...


@deprecated("Use mcp_use.agents.managers.tools.search_tools.ToolSearchInput")
class ToolSearchInput(_ToolSearchInput): ...
