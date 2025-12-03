# mcp_use/adapters/langchain_adapter.py
import warnings

from typing_extensions import deprecated

from mcp_use.agents.adapters.langchain_adapter import LangChainAdapter as _LangChainAdapter

warnings.warn(
    "mcp_use.adapters.langchain_adapter is deprecated. "
    "Use mcp_use.agents.adapters.langchain_adapter. "
    "This import will be removed in version 2.0.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.agents.adapters.langchain_adapter.LangChainAdapter")
class LangChainAdapter(_LangChainAdapter): ...
