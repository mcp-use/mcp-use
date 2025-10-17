# mcp_use/adapters/langchain_adapter.py
from typing_extensions import deprecated

from mcp_use.agents.adapters.langchain_adapter import LangChainAdapter as _LangChainAdapter


@deprecated("Use mcp_use.agents.adapters.langchain_adapter.LangChainAdapter")
class LangChainAdapter(_LangChainAdapter): ...
