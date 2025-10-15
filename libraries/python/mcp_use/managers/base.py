from abc import ABC, abstractmethod

from langchain_core.tools import BaseTool


class BaseServerManager(ABC):
    """Abstract base class for server managers.

    This class defines the interface for server managers that can be used with MCPAgent.
    Custom server managers should inherit from this class and implement the required methods.
    """

    @abstractmethod
    async def initialize(self) -> None:
        """Initialize the server manager."""
        raise NotImplementedError

    @property
    @abstractmethod
    def tools(self) -> list[BaseTool]:
        """Get all server management tools and tools from the active server.

        Returns:
            list of LangChain tools for server management plus tools from active server
        """
        raise NotImplementedError

    @abstractmethod
    def has_tool_changes(self, current_tool_names: set[str]) -> bool:
        """Check if the available tools have changed.
        Args:
            current_tool_names: Set of currently known tool names
        Returns:
            True if tools have changed, False otherwise
        """
        raise NotImplementedError
