"""
Unit tests for observability types and configuration classes.
"""

import pytest

from mcp_use.observability.types import (
    BaseObservabilityConfig,
    LangchainObservability,
    LangfuseObservabilityConfig,
    ObservabilityInput,
)


class TestLangfuseObservabilityConfig:
    """Test LangfuseObservabilityConfig class."""

    def test_default_initialization(self):
        """Test default configuration values."""
        config = LangfuseObservabilityConfig()

        assert config.enabled is True
        assert config.trace_level == "basic"
        assert config.capture_tool_inputs is True
        assert config.capture_tool_outputs is True
        assert config.capture_context is True
        assert config.filter_sensitive_data is True
        assert config.session_id is None
        assert config.user_id is None
        assert config.metadata == {}

    def test_custom_initialization(self):
        """Test configuration with custom values."""
        metadata = {"test": "value", "environment": "development"}
        config = LangfuseObservabilityConfig(
            enabled=False,
            trace_level="verbose",
            capture_tool_inputs=False,
            capture_tool_outputs=False,
            capture_context=False,
            filter_sensitive_data=False,
            session_id="test_session_123",
            user_id="test_user_456",
            metadata=metadata,
        )

        assert config.enabled is False
        assert config.trace_level == "verbose"
        assert config.capture_tool_inputs is False
        assert config.capture_tool_outputs is False
        assert config.capture_context is False
        assert config.filter_sensitive_data is False
        assert config.session_id == "test_session_123"
        assert config.user_id == "test_user_456"
        assert config.metadata == metadata

    def test_trace_level_validation(self):
        """Test that trace level accepts valid values."""
        for level in ["basic", "detailed", "verbose"]:
            config = LangfuseObservabilityConfig(trace_level=level)
            assert config.trace_level == level

    def test_is_enabled(self):
        """Test is_enabled method."""
        config_enabled = LangfuseObservabilityConfig(enabled=True)
        config_disabled = LangfuseObservabilityConfig(enabled=False)

        assert config_enabled.is_enabled() is True
        assert config_disabled.is_enabled() is False

    def test_to_dict(self):
        """Test conversion to dictionary."""
        metadata = {"env": "test"}
        config = LangfuseObservabilityConfig(
            enabled=True,
            trace_level="detailed",
            capture_tool_inputs=False,
            session_id="session123",
            user_id="user456",
            metadata=metadata,
        )

        result = config.to_dict()
        expected = {
            "enabled": True,
            "traceLevel": "detailed",
            "captureToolInputs": False,
            "captureToolOutputs": True,  # default
            "captureContext": True,  # default
            "filterSensitiveData": True,  # default
            "sessionId": "session123",
            "userId": "user456",
            "metadata": metadata,
        }

        assert result == expected

    def test_metadata_is_copied(self):
        """Test that metadata is properly copied to avoid reference issues."""
        original_metadata = {"key": "value"}
        config = LangfuseObservabilityConfig(metadata=original_metadata)

        # Modify original metadata
        original_metadata["new_key"] = "new_value"

        # Config should not be affected
        assert "new_key" not in config.metadata
        assert config.metadata == {"key": "value"}

    def test_inheritance_from_base(self):
        """Test that LangfuseObservabilityConfig inherits from BaseObservabilityConfig."""
        config = LangfuseObservabilityConfig()
        assert isinstance(config, BaseObservabilityConfig)


class TestTypeAliases:
    """Test type aliases and input types."""

    def test_langchain_observability_type(self):
        """Test LangchainObservability type alias."""
        config = LangfuseObservabilityConfig()
        observability: LangchainObservability = {"langfuse": config}

        assert "langfuse" in observability
        assert isinstance(observability["langfuse"], BaseObservabilityConfig)

    def test_observability_input_with_config_objects(self):
        """Test ObservabilityInput with configuration objects."""
        config = LangfuseObservabilityConfig(trace_level="verbose")
        observability_input: ObservabilityInput = {"langfuse": config}

        assert observability_input is not None
        assert "langfuse" in observability_input

    def test_observability_input_with_dicts(self):
        """Test ObservabilityInput with dictionary configurations."""
        observability_input: ObservabilityInput = {
            "langfuse": {"enabled": True, "trace_level": "detailed", "session_id": "test_session"}
        }

        assert observability_input is not None
        assert "langfuse" in observability_input
        assert observability_input["langfuse"]["enabled"] is True

    def test_observability_input_none(self):
        """Test ObservabilityInput with None value."""
        observability_input: ObservabilityInput = None
        assert observability_input is None
