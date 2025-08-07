"""
Unit tests for enhanced Langfuse observability module.
"""

import os
from unittest.mock import MagicMock, Mock, patch

import pytest

from mcp_use.observability.types import LangfuseObservabilityConfig


class TestLangfuseModule:
    """Test the enhanced Langfuse observability module."""

    def setup_method(self):
        """Reset module state before each test."""
        # Reset global state
        import mcp_use.observability.langfuse as langfuse_module

        langfuse_module._langfuse_client = None
        langfuse_module._current_config = None

    def test_is_langfuse_available_true(self):
        """Test Langfuse availability check when available."""
        import sys
        import types

        from mcp_use.observability.langfuse import _is_langfuse_available

        dummy_langfuse = types.ModuleType("langfuse")
        dummy_langfuse.langchain = types.SimpleNamespace(CallbackHandler=Mock)

        with patch.dict(
            sys.modules,
            {
                "langfuse": dummy_langfuse,
                "langfuse.langchain": dummy_langfuse.langchain,
            },
        ):
            assert _is_langfuse_available() is True

    def test_is_langfuse_available_false(self):
        """Test Langfuse availability check when not available."""
        from mcp_use.observability.langfuse import _is_langfuse_available

        with patch("builtins.__import__", side_effect=ImportError):
            assert _is_langfuse_available() is False

    def test_has_required_env_vars_true(self):
        """Test environment variable check when both are present."""
        from mcp_use.observability.langfuse import _has_required_env_vars

        with patch.dict(
            os.environ, {"LANGFUSE_PUBLIC_KEY": "test_public_key", "LANGFUSE_SECRET_KEY": "test_secret_key"}
        ):
            assert _has_required_env_vars() is True

    def test_has_required_env_vars_false(self):
        """Test environment variable check when missing."""
        from mcp_use.observability.langfuse import _has_required_env_vars

        with patch.dict(os.environ, {}, clear=True):
            assert _has_required_env_vars() is False

    def test_is_disabled_by_env_true(self):
        """Test environment disable check when disabled."""
        from mcp_use.observability.langfuse import _is_disabled_by_env

        with patch.dict(os.environ, {"MCP_USE_LANGFUSE": "false"}):
            assert _is_disabled_by_env() is True

    def test_is_disabled_by_env_false(self):
        """Test environment disable check when not disabled."""
        from mcp_use.observability.langfuse import _is_disabled_by_env

        with patch.dict(os.environ, {}, clear=True):
            assert _is_disabled_by_env() is False

    def test_configure_langfuse_disabled_by_env(self):
        """Test configuration when disabled by environment variable."""
        from mcp_use.observability.langfuse import _langfuse_client, configure_langfuse

        config = LangfuseObservabilityConfig(enabled=True)

        with patch("mcp_use.observability.langfuse._is_disabled_by_env", return_value=True):
            configure_langfuse(config)

            assert _langfuse_client is None

    def test_configure_langfuse_disabled_by_config(self):
        """Test configuration when disabled by config."""
        from mcp_use.observability.langfuse import _langfuse_client, configure_langfuse

        config = LangfuseObservabilityConfig(enabled=False)

        with patch("mcp_use.observability.langfuse._is_disabled_by_env", return_value=False):
            configure_langfuse(config)

            assert _langfuse_client is None

    def test_configure_langfuse_missing_env_vars(self):
        """Test configuration when environment variables are missing."""
        from mcp_use.observability.langfuse import _langfuse_client, configure_langfuse

        config = LangfuseObservabilityConfig(enabled=True)

        with patch("mcp_use.observability.langfuse._is_disabled_by_env", return_value=False):
            with patch("mcp_use.observability.langfuse._has_required_env_vars", return_value=False):
                configure_langfuse(config)

                assert _langfuse_client is None

    def test_configure_langfuse_not_available(self):
        """Test configuration when Langfuse is not available."""
        from mcp_use.observability.langfuse import _langfuse_client, configure_langfuse

        config = LangfuseObservabilityConfig(enabled=True)

        with patch("mcp_use.observability.langfuse._is_disabled_by_env", return_value=False):
            with patch("mcp_use.observability.langfuse._has_required_env_vars", return_value=True):
                with patch("mcp_use.observability.langfuse._is_langfuse_available", return_value=False):
                    configure_langfuse(config)

                    assert _langfuse_client is None

    def test_configure_langfuse_success(self):
        """Test successful Langfuse configuration."""
        from mcp_use.observability.langfuse import _current_config, _langfuse_client, configure_langfuse

        config = LangfuseObservabilityConfig(enabled=True, trace_level="detailed")

        mock_langfuse = Mock()

        with patch("mcp_use.observability.langfuse._is_disabled_by_env", return_value=False):
            with patch("mcp_use.observability.langfuse._has_required_env_vars", return_value=True):
                with patch("mcp_use.observability.langfuse._is_langfuse_available", return_value=True):
                    with patch.dict(
                        os.environ, {"LANGFUSE_PUBLIC_KEY": "test_public", "LANGFUSE_SECRET_KEY": "test_secret"}
                    ):
                        with patch("mcp_use.observability.langfuse.Langfuse", return_value=mock_langfuse):
                            configure_langfuse(config)

                            assert _langfuse_client == mock_langfuse
                            assert _current_config == config

    def test_configure_langfuse_initialization_error(self):
        """Test configuration when Langfuse initialization fails."""
        from mcp_use.observability.langfuse import _langfuse_client, configure_langfuse

        config = LangfuseObservabilityConfig(enabled=True)

        with patch("mcp_use.observability.langfuse._is_disabled_by_env", return_value=False):
            with patch("mcp_use.observability.langfuse._has_required_env_vars", return_value=True):
                with patch("mcp_use.observability.langfuse._is_langfuse_available", return_value=True):
                    with patch("mcp_use.observability.langfuse.Langfuse", side_effect=Exception("Init error")):
                        configure_langfuse(config)

                        assert _langfuse_client is None

    def test_get_langfuse_callbacks_no_client(self):
        """Test getting callbacks when no client is configured."""
        from mcp_use.observability.langfuse import get_langfuse_callbacks

        callbacks = get_langfuse_callbacks()
        assert callbacks == []

    def test_get_langfuse_callbacks_disabled_config(self):
        """Test getting callbacks when config is disabled."""
        from mcp_use.observability.langfuse import configure_langfuse, get_langfuse_callbacks

        config = LangfuseObservabilityConfig(enabled=False)

        with patch("mcp_use.observability.langfuse._is_disabled_by_env", return_value=False):
            configure_langfuse(config)
            callbacks = get_langfuse_callbacks()
            assert callbacks == []

    def test_get_langfuse_callbacks_success(self):
        """Test successful callback generation."""
        from mcp_use.observability.langfuse import configure_langfuse, get_langfuse_callbacks

        config = LangfuseObservabilityConfig(
            enabled=True,
            trace_level="detailed",
            session_id="test_session",
            user_id="test_user",
            metadata={"env": "test"},
        )

        mock_langfuse = Mock()
        mock_handler = Mock()

        with patch("mcp_use.observability.langfuse._is_disabled_by_env", return_value=False):
            with patch("mcp_use.observability.langfuse._has_required_env_vars", return_value=True):
                with patch("mcp_use.observability.langfuse._is_langfuse_available", return_value=True):
                    with patch.dict(
                        os.environ, {"LANGFUSE_PUBLIC_KEY": "test_public", "LANGFUSE_SECRET_KEY": "test_secret"}
                    ):
                        with patch("mcp_use.observability.langfuse.Langfuse", return_value=mock_langfuse):
                            configure_langfuse(config)

                            with patch("mcp_use.observability.langfuse.CallbackHandler", return_value=mock_handler):
                                callbacks = get_langfuse_callbacks()

                                assert callbacks == [mock_handler]

    def test_get_langfuse_callbacks_import_error(self):
        """Test callback generation when import fails."""
        from mcp_use.observability.langfuse import configure_langfuse, get_langfuse_callbacks

        config = LangfuseObservabilityConfig(enabled=True)
        mock_langfuse = Mock()

        with patch("mcp_use.observability.langfuse._is_disabled_by_env", return_value=False):
            with patch("mcp_use.observability.langfuse._has_required_env_vars", return_value=True):
                with patch("mcp_use.observability.langfuse._is_langfuse_available", return_value=True):
                    with patch.dict(
                        os.environ, {"LANGFUSE_PUBLIC_KEY": "test_public", "LANGFUSE_SECRET_KEY": "test_secret"}
                    ):
                        with patch("mcp_use.observability.langfuse.Langfuse", return_value=mock_langfuse):
                            configure_langfuse(config)

                            # Mock import error for CallbackHandler
                            with patch("builtins.__import__", side_effect=ImportError):
                                callbacks = get_langfuse_callbacks()
                                assert callbacks == []

    def test_get_langfuse_callbacks_creation_error(self):
        """Test callback generation when handler creation fails."""
        from mcp_use.observability.langfuse import configure_langfuse, get_langfuse_callbacks

        config = LangfuseObservabilityConfig(enabled=True)
        mock_langfuse = Mock()

        with patch("mcp_use.observability.langfuse._is_disabled_by_env", return_value=False):
            with patch("mcp_use.observability.langfuse._has_required_env_vars", return_value=True):
                with patch("mcp_use.observability.langfuse._is_langfuse_available", return_value=True):
                    with patch.dict(
                        os.environ, {"LANGFUSE_PUBLIC_KEY": "test_public", "LANGFUSE_SECRET_KEY": "test_secret"}
                    ):
                        with patch("mcp_use.observability.langfuse.Langfuse", return_value=mock_langfuse):
                            configure_langfuse(config)

                            with patch(
                                "mcp_use.observability.langfuse.CallbackHandler",
                                side_effect=Exception("Creation error"),
                            ):
                                callbacks = get_langfuse_callbacks()
                                assert callbacks == []

    def test_get_current_config(self):
        """Test getting current configuration."""
        from mcp_use.observability.langfuse import configure_langfuse, get_current_config

        config = LangfuseObservabilityConfig(enabled=True, trace_level="verbose")

        with patch("mcp_use.observability.langfuse._is_disabled_by_env", return_value=False):
            configure_langfuse(config)

            current = get_current_config()
            assert current == config

    def test_is_langfuse_enabled_true(self):
        """Test checking if Langfuse is enabled when it is."""
        from mcp_use.observability.langfuse import configure_langfuse, is_langfuse_enabled

        config = LangfuseObservabilityConfig(enabled=True)
        mock_langfuse = Mock()

        with patch("mcp_use.observability.langfuse._is_disabled_by_env", return_value=False):
            with patch("mcp_use.observability.langfuse._has_required_env_vars", return_value=True):
                with patch("mcp_use.observability.langfuse._is_langfuse_available", return_value=True):
                    with patch.dict(
                        os.environ, {"LANGFUSE_PUBLIC_KEY": "test_public", "LANGFUSE_SECRET_KEY": "test_secret"}
                    ):
                        with patch("mcp_use.observability.langfuse.Langfuse", return_value=mock_langfuse):
                            configure_langfuse(config)

                            assert is_langfuse_enabled() is True

    def test_is_langfuse_enabled_false(self):
        """Test checking if Langfuse is enabled when it's not."""
        from mcp_use.observability.langfuse import is_langfuse_enabled

        assert is_langfuse_enabled() is False

    def test_legacy_compatibility_initialization(self):
        """Test backward compatibility initialization."""
        from mcp_use.observability.langfuse import _initialize_legacy_compatibility

        mock_langfuse = Mock()

        with patch("mcp_use.observability.langfuse._is_disabled_by_env", return_value=False):
            with patch("mcp_use.observability.langfuse._has_required_env_vars", return_value=True):
                with patch("mcp_use.observability.langfuse._is_langfuse_available", return_value=True):
                    with patch.dict(
                        os.environ, {"LANGFUSE_PUBLIC_KEY": "test_public", "LANGFUSE_SECRET_KEY": "test_secret"}
                    ):
                        with patch("mcp_use.observability.langfuse.Langfuse", return_value=mock_langfuse):
                            _initialize_legacy_compatibility()

                            from mcp_use.observability.langfuse import _current_config, _langfuse_client

                            assert _langfuse_client == mock_langfuse
                            assert _current_config is not None

    def test_legacy_access_langfuse_client(self):
        """Test legacy access to Langfuse client."""
        from mcp_use.observability.langfuse import _LegacyAccess

        mock_client = Mock()
        legacy = _LegacyAccess()

        with patch("mcp_use.observability.langfuse._langfuse_client", mock_client):
            assert legacy.langfuse == mock_client

    def test_legacy_access_langfuse_handler(self):
        """Test legacy access to Langfuse handler."""
        from mcp_use.observability.langfuse import _LegacyAccess

        mock_handler = Mock()
        legacy = _LegacyAccess()

        with patch("mcp_use.observability.langfuse.get_langfuse_callbacks", return_value=[mock_handler]):
            assert legacy.langfuse_handler == mock_handler

        with patch("mcp_use.observability.langfuse.get_langfuse_callbacks", return_value=[]):
            assert legacy.langfuse_handler is None
