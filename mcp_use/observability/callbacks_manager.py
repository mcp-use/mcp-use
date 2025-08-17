"""
Observability callbacks manager for MCP-use.

This module provides a centralized manager for handling observability callbacks
from various platforms (Langfuse, Laminar, etc.) in a clean and extensible way.
"""

import logging

logger = logging.getLogger(__name__)


class ObservabilityManager:
    """
    Manages observability callbacks for MCP agents.

    This class provides a centralized way to collect and manage callbacks
    from various observability platforms (Langfuse, Laminar, etc.).
    """

    def __init__(self, custom_callbacks: list | None = None):
        """
        Initialize the ObservabilityManager.

        Args:
            custom_callbacks: Optional list of custom callbacks to use instead of defaults.
        """
        self.custom_callbacks = custom_callbacks
        self._available_handlers = []
        self._handler_names = []
        self._initialized = False

    def _collect_available_handlers(self) -> None:
        """Collect all available observability handlers from configured platforms."""
        if self._initialized:
            return

        # Import handlers lazily to avoid circular imports
        try:
            from .langfuse import langfuse_handler

            if langfuse_handler is not None:
                self._available_handlers.append(langfuse_handler)
                self._handler_names.append("Langfuse")
                logger.debug("ObservabilityManager: Langfuse handler available")
        except ImportError:
            logger.debug("ObservabilityManager: Langfuse module not available")

        try:
            from .laminar import laminar_handler, laminar_initialized

            if laminar_handler is not None:
                # We have a custom callback handler for Laminar
                self._available_handlers.append(laminar_handler)
                self._handler_names.append("Laminar")
                logger.debug("ObservabilityManager: Laminar callback handler available")
            elif laminar_initialized:
                # Laminar is initialized but using only automatic instrumentation
                self._handler_names.append("Laminar (auto-instrumentation)")
                logger.debug("ObservabilityManager: Laminar auto-instrumentation active (no callback handler)")
        except ImportError:
            logger.debug("ObservabilityManager: Laminar module not available")

        # Future: Add more platforms here...

        self._initialized = True

    def get_callbacks(self) -> list:
        """
        Get the list of callbacks to use.

        Returns:
            List of callbacks - either custom callbacks if provided,
            or all available observability handlers.
        """
        # If custom callbacks were provided, use those
        if self.custom_callbacks is not None:
            logger.debug(f"ObservabilityManager: Using {len(self.custom_callbacks)} custom callbacks")
            return self.custom_callbacks

        # Otherwise, collect and return all available handlers
        self._collect_available_handlers()

        if self._available_handlers:
            logger.debug(f"ObservabilityManager: Using {len(self._available_handlers)} handlers")
        else:
            logger.debug("ObservabilityManager: No callbacks configured")

        return self._available_handlers

    def get_handler_names(self) -> list[str]:
        """
        Get the names of available handlers.

        Returns:
            List of handler names (e.g., ["Langfuse", "Laminar"])
        """
        if self.custom_callbacks is not None:
            # For custom callbacks, try to get their class names
            return [type(cb).__name__ for cb in self.custom_callbacks]

        self._collect_available_handlers()
        return self._handler_names

    def has_callbacks(self) -> bool:
        """
        Check if any callbacks are available.

        Returns:
            True if callbacks are available, False otherwise.
        """
        callbacks = self.get_callbacks()
        return len(callbacks) > 0

    def add_callback(self, callback) -> None:
        """
        Add a callback to the custom callbacks list.

        Args:
            callback: The callback to add.
        """
        if self.custom_callbacks is None:
            self.custom_callbacks = []
        self.custom_callbacks.append(callback)
        logger.debug(f"ObservabilityManager: Added custom callback: {type(callback).__name__}")

    def clear_callbacks(self) -> None:
        """Clear all custom callbacks."""
        self.custom_callbacks = []
        logger.debug("ObservabilityManager: Cleared all custom callbacks")

    def __repr__(self) -> str:
        """String representation of the ObservabilityManager."""
        handler_names = self.get_handler_names()
        if handler_names:
            return f"ObservabilityManager(handlers={handler_names})"
        return "ObservabilityManager(no handlers)"


# Singleton instance for easy access
_default_manager = None


def get_default_manager() -> ObservabilityManager:
    """
    Get the default ObservabilityManager instance.

    Returns:
        The default ObservabilityManager instance (singleton).
    """
    global _default_manager
    if _default_manager is None:
        _default_manager = ObservabilityManager()
    return _default_manager


def create_manager(custom_callbacks: list | None = None) -> ObservabilityManager:
    """
    Create a new ObservabilityManager instance.

    Args:
        custom_callbacks: Optional list of custom callbacks.

    Returns:
        A new ObservabilityManager instance.
    """
    return ObservabilityManager(custom_callbacks=custom_callbacks)
