"""
Observability manager for handling multiple observability providers.
"""

import logging
from typing import Any

from .types import (
    BaseObservabilityConfig,
    LangchainObservability,
    LangfuseObservabilityConfig,
    ObservabilityInput,
)

# Expose provider hooks at module scope so tests can patch them
try:
    from .langfuse import configure_langfuse, get_langfuse_callbacks  # type: ignore
except Exception:  # pragma: no cover - optional dependency may be missing
    configure_langfuse = None  # type: ignore
    get_langfuse_callbacks = None  # type: ignore

logger = logging.getLogger(__name__)


class ObservabilityManager:
    """Manager for handling observability providers and their configurations."""

    def __init__(self, observability_config: ObservabilityInput = None):
        """Initialize the observability manager.

        Args:
            observability_config: Dictionary mapping provider names to configurations
        """
        self._providers: LangchainObservability = {}
        self._configured = False

        if observability_config:
            self.configure(observability_config)

    def configure(self, observability_config: ObservabilityInput) -> None:
        """Configure observability providers.

        Args:
            observability_config: Configuration for observability providers
        """
        if not observability_config:
            return

        self._providers = {}

        for provider_name, config in observability_config.items():
            if provider_name == "langfuse":
                self._configure_langfuse(config)
            else:
                logger.warning(f"Unknown observability provider: {provider_name}")

        self._configured = True
        logger.debug(f"Configured observability providers: {list(self._providers.keys())}")

    def _configure_langfuse(self, config: LangfuseObservabilityConfig | dict[str, Any]) -> None:
        """Configure Langfuse observability provider.

        Args:
            config: Langfuse configuration object or dictionary
        """
        if isinstance(config, dict):
            # Convert dict to LangfuseObservabilityConfig
            langfuse_config = LangfuseObservabilityConfig(**config)
        elif isinstance(config, LangfuseObservabilityConfig):
            langfuse_config = config
        else:
            logger.warning(f"Invalid Langfuse configuration type: {type(config)}")
            return

        self._providers["langfuse"] = langfuse_config
        try:
            logger.info(
                f"🔧 Configuring Langfuse observability "
                f"(trace_level: {langfuse_config.trace_level}, enabled: {langfuse_config.enabled})"
            )
        except Exception:
            pass

        # Configure the actual Langfuse provider
        try:
            if configure_langfuse is None:
                logger.debug("Langfuse module not available")
            else:
                configure_langfuse(langfuse_config)  # type: ignore[arg-type]
                try:
                    logger.debug(f"✅ Langfuse configured successfully with trace level: {langfuse_config.trace_level}")
                except Exception:
                    pass
        except Exception as e:
            try:
                logger.warning(f"Failed to configure Langfuse: {e}")
            except Exception:
                pass

    def get_callbacks(self) -> list[Any]:
        """Get all callback handlers for LangChain integration.

        Returns:
            List of callback handlers from all configured providers
        """
        callbacks = []

        # Get Langfuse callbacks if configured
        if "langfuse" in self._providers:
            try:
                if get_langfuse_callbacks is None:
                    logger.debug("Langfuse module not available")
                else:
                    callbacks.extend(get_langfuse_callbacks())  # type: ignore[misc]
            except Exception as e:
                try:
                    logger.debug(f"Failed to get Langfuse callbacks: {e}")
                except Exception:
                    pass

        return callbacks

    def is_any_provider_enabled(self) -> bool:
        """Check if any observability provider is enabled.

        Returns:
            True if any provider is enabled, False otherwise
        """
        return any(config.is_enabled() for config in self._providers.values())

    def get_provider_config(self, provider_name: str) -> BaseObservabilityConfig | None:
        """Get configuration for a specific provider.

        Args:
            provider_name: Name of the provider

        Returns:
            Provider configuration or None if not found
        """
        return self._providers.get(provider_name)

    def get_enabled_providers(self) -> list[str]:
        """Get list of enabled provider names.

        Returns:
            List of enabled provider names
        """
        return [name for name, config in self._providers.items() if config.is_enabled()]

    def update_session_context(self, session_id: str | None = None, user_id: str | None = None) -> None:
        """Update session context for all providers that support it.

        Args:
            session_id: Optional session ID
            user_id: Optional user ID
        """
        # Update Langfuse configuration if present
        if "langfuse" in self._providers:
            langfuse_config = self._providers["langfuse"]
            if isinstance(langfuse_config, LangfuseObservabilityConfig):
                if session_id is not None:
                    langfuse_config.session_id = session_id
                if user_id is not None:
                    langfuse_config.user_id = user_id

                # Reconfigure Langfuse with updated context
                try:
                    if configure_langfuse is not None:
                        configure_langfuse(langfuse_config)  # type: ignore[arg-type]
                except Exception as e:
                    try:
                        logger.debug(f"Failed to update Langfuse session context: {e}")
                    except Exception:
                        pass


# Global instance for backward compatibility
_global_manager: ObservabilityManager | None = None


def get_global_observability_manager() -> ObservabilityManager:
    """Get the global observability manager instance.

    Returns:
        Global observability manager
    """
    global _global_manager
    if _global_manager is None:
        _global_manager = ObservabilityManager()
    return _global_manager


def configure_global_observability(observability_config: ObservabilityInput) -> None:
    """Configure the global observability manager.

    Args:
        observability_config: Configuration for observability providers
    """
    global _global_manager
    _global_manager = ObservabilityManager(observability_config)
