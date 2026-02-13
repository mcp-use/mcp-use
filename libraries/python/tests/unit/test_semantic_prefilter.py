"""
Unit tests for semantic pre-filtering functionality.
"""

import pytest

from mcp_use.client.code_mode_config import CodeModeConfig, SemanticPreFilterConfig
from mcp_use.client.semantic_prefilter import SemanticPreFilter


class TestSemanticPreFilterConfig:
    """Tests for SemanticPreFilterConfig."""

    def test_default_config(self):
        """Test default configuration values."""
        config = SemanticPreFilterConfig()

        assert config.enabled is False
        assert config.top_k_initial == 50
        assert config.top_k_final == 20
        assert config.enum_reduction_threshold == 10
        assert config.use_reranking is True

    def test_custom_config(self):
        """Test custom configuration values."""
        config = SemanticPreFilterConfig(
            enabled=True,
            top_k_initial=100,
            top_k_final=30,
            enum_reduction_threshold=20,
            use_reranking=False,
        )

        assert config.enabled is True
        assert config.top_k_initial == 100
        assert config.top_k_final == 30
        assert config.enum_reduction_threshold == 20
        assert config.use_reranking is False


class TestCodeModeConfig:
    """Tests for CodeModeConfig."""

    def test_default_config(self):
        """Test default configuration values."""
        config = CodeModeConfig()

        assert config.enabled is True
        assert config.semantic_prefilter is None

    def test_config_with_prefilter(self):
        """Test configuration with semantic pre-filtering."""
        prefilter_config = SemanticPreFilterConfig(enabled=True)
        config = CodeModeConfig(semantic_prefilter=prefilter_config)

        assert config.enabled is True
        assert config.semantic_prefilter is not None
        assert config.semantic_prefilter.enabled is True

    def test_from_bool(self):
        """Test creating config from boolean."""
        config_true = CodeModeConfig.from_bool(True)
        assert config_true.enabled is True

        config_false = CodeModeConfig.from_bool(False)
        assert config_false.enabled is False


class TestSemanticPreFilter:
    """Tests for SemanticPreFilter class."""

    def test_initialization(self):
        """Test SemanticPreFilter initialization."""
        prefilter = SemanticPreFilter()

        assert prefilter.top_k_initial == 50
        assert prefilter.top_k_final == 20
        assert prefilter.enum_reduction_threshold == 10

    def test_cosine_similarity(self):
        """Test cosine similarity calculation."""
        prefilter = SemanticPreFilter()

        # Test identical vectors
        vec1 = [1.0, 0.0, 0.0]
        vec2 = [1.0, 0.0, 0.0]
        similarity = prefilter._cosine_similarity(vec1, vec2)
        assert abs(similarity - 1.0) < 0.001

        # Test orthogonal vectors
        vec1 = [1.0, 0.0]
        vec2 = [0.0, 1.0]
        similarity = prefilter._cosine_similarity(vec1, vec2)
        assert abs(similarity - 0.0) < 0.001

        # Test empty vectors
        similarity = prefilter._cosine_similarity([], [])
        assert similarity == 0.0

    def test_filter_schema_enums(self):
        """Test enum filtering in JSON schema."""
        prefilter = SemanticPreFilter(enum_reduction_threshold=3)

        schema = {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
                },
                "small_enum": {
                    "type": "string",
                    "enum": ["x", "y"],
                },
            },
        }

        prefilter._filter_schema_enums(schema)

        # Large enum should be filtered
        assert len(schema["properties"]["status"]["enum"]) == 3
        assert schema["properties"]["status"]["_enum_filtered"] is True
        assert schema["properties"]["status"]["_enum_original_count"] == 10

        # Small enum should not be filtered
        assert len(schema["properties"]["small_enum"]["enum"]) == 2
        assert "_enum_filtered" not in schema["properties"]["small_enum"]

    def test_filter_schema_enums_nested(self):
        """Test enum filtering in nested schemas."""
        prefilter = SemanticPreFilter(enum_reduction_threshold=2)

        schema = {
            "type": "object",
            "properties": {
                "nested": {
                    "type": "object",
                    "properties": {
                        "value": {
                            "type": "string",
                            "enum": ["a", "b", "c", "d"],
                        },
                    },
                },
                "array": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": ["x", "y", "z", "w"],
                    },
                },
            },
        }

        prefilter._filter_schema_enums(schema)

        # Nested enum should be filtered
        assert len(schema["properties"]["nested"]["properties"]["value"]["enum"]) == 2

        # Array items enum should be filtered
        assert len(schema["properties"]["array"]["items"]["enum"]) == 2

