"""
Unit tests for ObservabilityManager class.
"""

from unittest.mock import MagicMock, Mock, patch

import pytest

from mcp_use.observability.manager import (
    ObservabilityManager,
    configure_global_observability,
    get_global_observability_manager,
)
from mcp_use.observability.types import LangfuseObservabilityConfig


class TestObservabilityManager:
    """Test ObservabilityManager class."""

    def test_initialization_empty(self):
        """Test initialization with no configuration."""
        manager = ObservabilityManager()

        assert manager._providers == {}
        assert manager._configured is False
        assert manager.get_callbacks() == []
        assert not manager.is_any_provider_enabled()

    def test_initialization_with_config(self):
        """Test initialization with configuration."""
        config = LangfuseObservabilityConfig(enabled=True, trace_level="detailed")
        observability_config = {"langfuse": config}

        with patch("mcp_use.observability.manager.configure_langfuse") as mock_configure:
            manager = ObservabilityManager(observability_config)

            assert "langfuse" in manager._providers
            assert manager._configured is True
            mock_configure.assert_called_once_with(config)

    def test_configure_with_langfuse_config_object(self):
        """Test configuring with LangfuseObservabilityConfig object."""
        manager = ObservabilityManager()
        config = LangfuseObservabilityConfig(enabled=True, trace_level="verbose")

        with patch("mcp_use.observability.manager.configure_langfuse") as mock_configure:
            manager.configure({"langfuse": config})

            assert "langfuse" in manager._providers
            assert manager._providers["langfuse"] == config
            mock_configure.assert_called_once_with(config)

    def test_configure_with_langfuse_dict(self):
        """Test configuring with dictionary configuration."""
        manager = ObservabilityManager()
        config_dict = {
            "enabled": True,
            "trace_level": "detailed",
            "capture_tool_inputs": False,
            "session_id": "test_session",
        }

        with patch("mcp_use.observability.manager.configure_langfuse") as mock_configure:
            manager.configure({"langfuse": config_dict})

            assert "langfuse" in manager._providers
            assert isinstance(manager._providers["langfuse"], LangfuseObservabilityConfig)
            assert manager._providers["langfuse"].trace_level == "detailed"
            assert manager._providers["langfuse"].capture_tool_inputs is False
            mock_configure.assert_called_once()

    def test_configure_with_invalid_langfuse_config(self):
        """Test configuring with invalid configuration type."""
        manager = ObservabilityManager()

        with patch("mcp_use.observability.manager.logger") as mock_logger:
            manager.configure({"langfuse": "invalid_config"})

            assert "langfuse" not in manager._providers
            mock_logger.warning.assert_called_once()

    def test_configure_with_unknown_provider(self):
        """Test configuring with unknown provider."""
        manager = ObservabilityManager()

        with patch("mcp_use.observability.manager.logger") as mock_logger:
            manager.configure({"unknown_provider": {"enabled": True}})

            assert "unknown_provider" not in manager._providers
            mock_logger.warning.assert_called_with("Unknown observability provider: unknown_provider")

    def test_get_callbacks_no_providers(self):
        """Test getting callbacks when no providers are configured."""
        manager = ObservabilityManager()

        callbacks = manager.get_callbacks()
        assert callbacks == []

    def test_get_callbacks_with_langfuse(self):
        """Test getting callbacks with Langfuse configured."""
        manager = ObservabilityManager()
        config = LangfuseObservabilityConfig(enabled=True)

        mock_callbacks = [Mock(), Mock()]

        with patch("mcp_use.observability.manager.configure_langfuse"):
            with patch("mcp_use.observability.manager.get_langfuse_callbacks", return_value=mock_callbacks):
                manager.configure({"langfuse": config})
                callbacks = manager.get_callbacks()

                assert callbacks == mock_callbacks

    def test_get_callbacks_langfuse_import_error(self):
        """Test getting callbacks when Langfuse import fails."""
        manager = ObservabilityManager()
        config = LangfuseObservabilityConfig(enabled=True)

        with patch("mcp_use.observability.manager.configure_langfuse"):
            with patch("mcp_use.observability.manager.get_langfuse_callbacks", side_effect=ImportError):
                manager.configure({"langfuse": config})
                callbacks = manager.get_callbacks()

                assert callbacks == []

    def test_get_callbacks_langfuse_other_error(self):
        """Test getting callbacks when Langfuse has other errors."""
        manager = ObservabilityManager()
        config = LangfuseObservabilityConfig(enabled=True)

        with patch("mcp_use.observability.manager.configure_langfuse"):
            with patch("mcp_use.observability.manager.get_langfuse_callbacks", side_effect=Exception("Test error")):
                manager.configure({"langfuse": config})
                callbacks = manager.get_callbacks()

                assert callbacks == []

    def test_is_any_provider_enabled(self):
        """Test checking if any provider is enabled."""
        manager = ObservabilityManager()

        # No providers
        assert not manager.is_any_provider_enabled()

        # Disabled provider
        config_disabled = LangfuseObservabilityConfig(enabled=False)
        with patch("mcp_use.observability.manager.configure_langfuse"):
            manager.configure({"langfuse": config_disabled})
            assert not manager.is_any_provider_enabled()

        # Enabled provider
        config_enabled = LangfuseObservabilityConfig(enabled=True)
        with patch("mcp_use.observability.manager.configure_langfuse"):
            manager.configure({"langfuse": config_enabled})
            assert manager.is_any_provider_enabled()

    def test_get_provider_config(self):
        """Test getting provider configuration."""
        manager = ObservabilityManager()
        config = LangfuseObservabilityConfig(enabled=True, trace_level="verbose")

        with patch("mcp_use.observability.manager.configure_langfuse"):
            manager.configure({"langfuse": config})

            assert manager.get_provider_config("langfuse") == config
            assert manager.get_provider_config("nonexistent") is None

    def test_get_enabled_providers(self):
        """Test getting list of enabled providers."""
        manager = ObservabilityManager()

        # No providers
        assert manager.get_enabled_providers() == []

        # Mix of enabled and disabled
        config_enabled = LangfuseObservabilityConfig(enabled=True)
        config_disabled = LangfuseObservabilityConfig(enabled=False)

        # Manually set providers for testing (bypassing configure to avoid mocking)
        manager._providers = {"langfuse": config_enabled, "disabled_provider": config_disabled}

        enabled = manager.get_enabled_providers()
        assert "langfuse" in enabled
        assert "disabled_provider" not in enabled

    def test_update_session_context(self):
        """Test updating session context."""
        manager = ObservabilityManager()
        config = LangfuseObservabilityConfig(enabled=True)

        with patch("mcp_use.observability.manager.configure_langfuse") as mock_configure:
            manager.configure({"langfuse": config})

            # Update session context
            manager.update_session_context(session_id="new_session", user_id="new_user")

            # Check that config was updated
            assert config.session_id == "new_session"
            assert config.user_id == "new_user"

            # configure_langfuse should be called twice: once for initial config, once for update
            assert mock_configure.call_count == 2

    def test_update_session_context_partial(self):
        """Test updating session context with partial information."""
        manager = ObservabilityManager()
        config = LangfuseObservabilityConfig(enabled=True, session_id="old_session", user_id="old_user")

        with patch("mcp_use.observability.manager.configure_langfuse"):
            manager.configure({"langfuse": config})

            # Update only session_id
            manager.update_session_context(session_id="new_session")

            assert config.session_id == "new_session"
            assert config.user_id == "old_user"  # Should remain unchanged

    def test_update_session_context_no_langfuse(self):
        """Test updating session context when Langfuse is not configured."""
        manager = ObservabilityManager()

        # Should not raise an error
        manager.update_session_context(session_id="test", user_id="test")

    def test_update_session_context_with_error(self):
        """Test updating session context when reconfiguration fails."""
        manager = ObservabilityManager()
        config = LangfuseObservabilityConfig(enabled=True)

        with patch("mcp_use.observability.manager.configure_langfuse", side_effect=Exception("Test error")):
            manager.configure({"langfuse": config})

            # Should not raise an error, but log it
            with patch("mcp_use.observability.manager.logger"):
                manager.update_session_context(session_id="test")
                # Note: The debug log is called, but we don't need to assert it for this test


class TestGlobalObservabilityManager:
    """Test global observability manager functions."""

    def test_get_global_observability_manager(self):
        """Test getting the global observability manager."""
        # Reset global state
        import mcp_use.observability.manager as manager_module

        manager_module._global_manager = None

        manager1 = get_global_observability_manager()
        manager2 = get_global_observability_manager()

        assert manager1 is manager2  # Should be singleton
        assert isinstance(manager1, ObservabilityManager)

    def test_configure_global_observability(self):
        """Test configuring the global observability manager."""
        config = LangfuseObservabilityConfig(enabled=True)
        observability_config = {"langfuse": config}

        with patch("mcp_use.observability.manager.configure_langfuse"):
            configure_global_observability(observability_config)

            manager = get_global_observability_manager()
            assert "langfuse" in manager._providers
