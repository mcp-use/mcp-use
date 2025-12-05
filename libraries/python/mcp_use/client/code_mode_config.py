"""
Configuration classes for Code Mode with semantic pre-filtering.
"""

from typing import Any

from pydantic import BaseModel, Field


class SemanticPreFilterConfig(BaseModel):
    """Configuration for semantic pre-filtering."""

    enabled: bool = Field(
        default=False,
        description="Whether to enable semantic pre-filtering before Code Mode",
    )
    embeddings_url: str | None = Field(
        default=None,
        description="URL for embeddings API (defaults to Qwen3-Embedding on DeepInfra)",
    )
    reranker_url: str | None = Field(
        default=None,
        description="URL for reranker API (defaults to Qwen3-Reranker on DeepInfra)",
    )
    embeddings_api_key: str | None = Field(
        default=None,
        description="API key for embeddings service (uses DEEPINFRA_API_KEY env var if not provided)",
    )
    reranker_api_key: str | None = Field(
        default=None,
        description="API key for reranker service (uses DEEPINFRA_API_KEY env var if not provided)",
    )
    top_k_initial: int = Field(
        default=50,
        ge=1,
        description="Number of tools to retrieve in initial semantic search",
    )
    top_k_final: int = Field(
        default=20,
        ge=1,
        description="Final number of tools after reranking",
    )
    enum_reduction_threshold: int = Field(
        default=10,
        ge=1,
        description="Minimum enum size to trigger reduction",
    )
    use_reranking: bool = Field(
        default=True,
        description="Whether to use reranking after semantic search",
    )
    query: str | None = Field(
        default=None,
        description="Optional query string for semantic search (if None, uses context from agent)",
    )


class CodeModeConfig(BaseModel):
    """Configuration for Code Mode execution."""

    enabled: bool = Field(
        default=True,
        description="Whether Code Mode is enabled",
    )
    semantic_prefilter: SemanticPreFilterConfig | None = Field(
        default=None,
        description="Configuration for semantic pre-filtering",
    )

    @classmethod
    def from_bool(cls, value: bool) -> "CodeModeConfig":
        """Create CodeModeConfig from a boolean value (for backwards compatibility).

        Args:
            value: Boolean indicating if code mode should be enabled

        Returns:
            CodeModeConfig instance
        """
        return cls(enabled=value)

