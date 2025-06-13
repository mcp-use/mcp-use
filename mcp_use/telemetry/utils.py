"""
Utility functions for extracting model information from LangChain LLMs.

This module provides utilities to extract provider and model information
from LangChain language models for telemetry purposes.
"""

import importlib.metadata

from langchain_core.language_models.base import BaseLanguageModel


def get_package_version() -> str:
    """Get the current mcp-use package version."""
    try:
        return importlib.metadata.version("mcp-use")
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def get_model_provider(llm: BaseLanguageModel) -> str:
    """Extract the model provider from LangChain LLM using BaseChatModel standards."""
    # Use LangChain's standard _llm_type property for identification
    return getattr(llm, "_llm_type", llm.__class__.__name__.lower())


def get_model_name(llm: BaseLanguageModel) -> str:
    """Extract the model name from LangChain LLM using BaseChatModel standards."""
    # First try _identifying_params which may contain model info
    if hasattr(llm, "_identifying_params"):
        identifying_params = llm._identifying_params
        if isinstance(identifying_params, dict):
            # Common keys that contain model names
            for key in ["model", "model_name", "model_id", "deployment_name"]:
                if key in identifying_params:
                    return str(identifying_params[key])

    # Fallback to direct model attributes
    return getattr(llm, "model", getattr(llm, "model_name", llm.__class__.__name__))


def extract_model_info(llm: BaseLanguageModel) -> tuple[str, str]:
    """Extract both provider and model name from LangChain LLM.

    Returns:
        Tuple of (provider, model_name)
    """
    return get_model_provider(llm), get_model_name(llm)
