"""
LLM Client for instructor integration.

This module provides a unified LLM client that handles the proper
setup and configuration of instructor-wrapped LLM clients using
the from_provider method.
"""

from typing import Any

import instructor
from instructor.core.client import AsyncInstructor, Instructor

from ..logging import logger


class LLMClient:
    """
    Unified LLM client that handles instructor integration.

    This class provides a clean interface for creating instructor-wrapped
    LLM clients from model names and API keys using instructor's from_provider.
    """

    def __init__(self, model_name: str, api_key: str | None = None, use_async: bool = True, **kwargs):
        """
        Initialize the LLM client with instructor integration.

        Args:
            model_name: Model name (e.g., "gpt-4", "claude-3-sonnet") or
                       provider/model format (e.g., "openai/gpt-4")
            api_key: API key for the LLM provider
            use_async: Whether to use async clients
            **kwargs: Additional arguments passed to the provider client
        """
        self.model_name = model_name
        self.api_key = api_key
        self.use_async = use_async
        self.kwargs = kwargs

        # Initialize the instructor client using from_provider
        self.client: Instructor | AsyncInstructor = self._create_instructor_client()

    def _create_instructor_client(self) -> Instructor | AsyncInstructor:
        """
        Create an instructor-wrapped LLM client using from_provider.

        Returns:
            Instructor-wrapped LLM client

        Raises:
            ValueError: If the model type cannot be determined or is unsupported
        """
        provider_kwargs = self.kwargs.copy()
        # Add API key if provided otherwise instructor will use the environment variable
        if self.api_key is not None:
            provider_kwargs["api_key"] = self.api_key
        # Always explicitly set async_client parameter
        provider_kwargs["async_client"] = self.use_async

        # Check if model name already contains provider (has "/" in it)
        if "/" in self.model_name:
            provider_string = self.model_name
        else:
            # Map model names to provider strings
            if "gpt" in self.model_name.lower() or "o1" in self.model_name.lower():
                provider_string = f"openai/{self.model_name}"
            elif "claude" in self.model_name.lower():
                provider_string = f"anthropic/{self.model_name}"
            elif "gemini" in self.model_name.lower():
                provider_string = f"google/{self.model_name}"
            elif "mistral" in self.model_name.lower():
                provider_string = f"mistral/{self.model_name}"
            else:
                raise ValueError(
                    f"Unknown model type: {self.model_name}. " f"Use format 'provider/model' or specify a known model."
                )

        logger.debug(f"Creating instructor client for provider: {provider_string}")

        try:
            self.client = instructor.from_provider(provider_string, **provider_kwargs)
            logger.debug(f"Successfully created instructor client for {provider_string}")
            return self.client
        except Exception as e:
            logger.error(f"Failed to create instructor client for {provider_string}: {e}")
            raise

    def __getattr__(self, name: str) -> Any:
        """
        Delegate attribute access to the instructor client.

        This allows the LLMClient to be used as a drop-in replacement
        for the instructor client.
        The method takes the requested attribute name and forwards it to the underlying instructor client.
        """
        return getattr(self.client, name)

    def __repr__(self) -> str:
        """String representation of the LLMClient."""
        return f"LLMClient(model_name='{self.model_name}', use_async={self.use_async})"
