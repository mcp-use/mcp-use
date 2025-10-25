"""
Base agent interface for MCP tools.

This module provides a base class for agents that use MCP tools.
"""

from abc import ABC, abstractmethod
from typing import Any

from litellm import Message

from mcp_use.llm.engine import LLM
from mcp_use.llm.tools import Tool


class BaseAgent(ABC):
    """Base class for agents that use MCP tools.

    This abstract class defines the interface for agents that use MCP tools.
    Agents are responsible for integrating LLMs with MCP tools.
    """

    def __init__(self, llm: LLM, name: str, instructions: str, tools: list[Tool]):
        """Initialize a new agent.

        Args:
            llm: The LLM to use for tool calls.
            name: The name of the agent.
            instructions: The instructions for the agent.
            tools: The tools to use for the agent.
        """
        self.llm = llm
        self.name = name
        self.instructions = instructions
        self.tools = tools
        self.messages: list[Message] = [Message(role="system", content=f"{instructions}")]
        self.tools_map = {tool.name: tool for tool in tools}

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
