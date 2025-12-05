"""
Integration tests for semantic pre-filtering with Code Mode.

These tests verify the end-to-end integration of semantic pre-filtering
with Code Mode, including tool filtering and enum parameter reduction.
"""

import pytest

from mcp_use import MCPClient, CodeModeConfig, SemanticPreFilterConfig


class TestSemanticPreFilterIntegration:
    """Integration tests for semantic pre-filtering with Code Mode."""

    def test_client_with_semantic_prefilter_config(self):
        """Test that MCPClient can be initialized with semantic pre-filtering config."""
        config = SemanticPreFilterConfig(
            enabled=True,
            top_k_initial=50,
            top_k_final=20,
            enum_reduction_threshold=10,
        )

        code_config = CodeModeConfig(
            enabled=True,
            semantic_prefilter=config,
        )

        client = MCPClient(code_mode=code_config)

        assert client.code_mode is True
        assert client.code_mode_config.semantic_prefilter is not None
        assert client.code_mode_config.semantic_prefilter.enabled is True

    def test_client_backwards_compatibility(self):
        """Test that boolean code_mode still works."""
        client = MCPClient(code_mode=True)

        assert client.code_mode is True
        assert client.code_mode_config.enabled is True
        # Semantic pre-filtering should be disabled by default
        assert (
            client.code_mode_config.semantic_prefilter is None
            or client.code_mode_config.semantic_prefilter.enabled is False
        )

    @pytest.mark.asyncio
    async def test_code_executor_with_prefilter_disabled(self):
        """Test that CodeExecutor works when pre-filtering is disabled."""
        client = MCPClient(code_mode=True)

        # Execute code - should work normally without pre-filtering
        result = await client.execute_code("return 42")

        assert result["error"] is None
        assert result["result"] == 42

    @pytest.mark.asyncio
    async def test_search_tools_with_prefilter_disabled(self):
        """Test search_tools works when pre-filtering is disabled."""
        client = MCPClient(code_mode=True)

        result = await client.search_tools("")

        assert "meta" in result
        assert "results" in result
        assert result["meta"]["total_tools"] >= 0

    def test_prefilter_config_defaults(self):
        """Test that pre-filter config has correct defaults."""
        config = SemanticPreFilterConfig()

        assert config.enabled is False
        assert config.top_k_initial == 50
        assert config.top_k_final == 20
        assert config.enum_reduction_threshold == 10
        assert config.use_reranking is True
        assert config.query is None

    def test_prefilter_config_custom_values(self):
        """Test that pre-filter config accepts custom values."""
        config = SemanticPreFilterConfig(
            enabled=True,
            top_k_initial=100,
            top_k_final=30,
            enum_reduction_threshold=15,
            use_reranking=False,
            query="custom query",
        )

        assert config.enabled is True
        assert config.top_k_initial == 100
        assert config.top_k_final == 30
        assert config.enum_reduction_threshold == 15
        assert config.use_reranking is False
        assert config.query == "custom query"

