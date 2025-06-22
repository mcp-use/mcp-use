"""
Base agent interface for MCP tools.

This module provides a base class for agents that use MCP tools.
"""

from abc import ABC, abstractmethod
from typing import Any

from ..session import MCPSession


class BaseAgent(ABC):
    """Base class for agents that use MCP tools.

    This abstract class defines the interface for agents that use MCP tools.
    Agents are responsible for integrating LLMs with MCP tools.
    """

    def __init__(self, session: MCPSession):
        """Initialize a new agent.

        Args:
            session: The MCP session to use for tool calls.
        """
        self.session = session

    @abstractmethod
    async def initialize(self) -> None:
        """Initialize the agent.

        This method should prepare the agent for use, including initializing
        the MCP session and setting up any necessary components.
        """
        pass

    @abstractmethod
    async def run(self, query: str, max_steps: int = 10) -> dict[str, Any]:
        """Run the agent with a query.

        Args:
            query: The query to run.
            max_steps: The maximum number of steps to run.

        Returns:
            The final result from the agent.
        """
        pass

    @abstractmethod
    async def step(self, query: str, previous_steps: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        """Perform a single step of the agent.

        Args:
            query: The query to run.
            previous_steps: Optional list of previous steps.

        Returns:
            The result of the step.
        """
        pass
