"""This module provides a high-level interface for interacting with Large Language Models (LLMs) using litellm."""

import logging
from collections.abc import AsyncGenerator

import litellm
from litellm import acompletion
from litellm.files.main import ModelResponse

from mcp_use.llm.responses import (
    Message,
    ToolMessage,
)
from mcp_use.llm.tools import Tool

logger = logging.getLogger(__name__)


class LLM:
    """A client for interacting with a Large Language Model."""

    def __init__(self, model: str):
        """Initialize the LLM client.

        Args:
            model: The name of the model to use (e.g., 'gpt-4o').
        """
        self.model = model
        self.client = acompletion

    async def stream(
        self, messages: list[Message | ToolMessage] | None = None, tools: list[Tool] | None = None
    ) -> AsyncGenerator[litellm.ModelResponseStream, None]:
        """Stream a completion request against the LLM.

        Args:
            messages: A list of messages forming the conversation history.

        Yields:
            Chunks of the model's reply.
        """
        # print("-" * 100)
        # print([tool.to_litellm() for tool in tools])
        # print("-" * 100)
        if messages is None:
            messages = []
        if tools is None:
            tools = []

        response_stream = await self.client(
            model=self.model,
            messages=[message.model_dump() for message in messages],
            tools=[tool.to_litellm() for tool in tools],
            stream=True,
        )

        async for chunk in response_stream:
            yield chunk

    async def run(
        self, messages: list[Message | ToolMessage] | None = None, tools: list[Tool] | None = None
    ) -> ModelResponse:
        """Run a completion request against the LLM.

        Args:
            messages: A list of messages forming the conversation history.

        Returns:
            An LLMResponse object containing the model's reply.
        """
        print("-" * 100)
        print([tool.to_litellm() for tool in tools])
        print("-" * 100)
        if messages is None:
            messages = []
        if tools is None:
            tools = []
        response = await self.client(
            model=self.model,
            messages=[message.model_dump() for message in messages],
            tools=[tool.to_litellm() for tool in tools],
        )
        return response
