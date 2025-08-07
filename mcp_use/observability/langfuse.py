import logging
import os
from typing import Any

from .types import LangfuseObservabilityConfig

logger = logging.getLogger(__name__)

# Global instances
_langfuse_client = None
_current_config: LangfuseObservabilityConfig | None = None

# Expose patchable references for tests
try:  # pragma: no cover
    from langfuse import Langfuse as Langfuse  # type: ignore
except Exception:  # pragma: no cover
    Langfuse = None  # type: ignore

try:  # pragma: no cover
    from langfuse.langchain import CallbackHandler as CallbackHandler  # type: ignore
except Exception:  # pragma: no cover
    CallbackHandler = None  # type: ignore


def _is_langfuse_available() -> bool:
    """Check if Langfuse is available for import."""
    return Langfuse is not None and CallbackHandler is not None


def _has_required_env_vars() -> bool:
    """Check if required environment variables are set."""
    return bool(os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY"))


def _is_disabled_by_env() -> bool:
    """Check if Langfuse is disabled via environment variable."""
    return os.getenv("MCP_USE_LANGFUSE", "").lower() == "false"


def configure_langfuse(config: LangfuseObservabilityConfig) -> None:
    """Configure Langfuse with the provided configuration.

    Args:
        config: Langfuse observability configuration
    """
    global _langfuse_client, _current_config

    _current_config = config

    # Reset client
    _langfuse_client = None

    if _is_disabled_by_env():
        logger.debug("Langfuse tracing disabled via MCP_USE_LANGFUSE environment variable")
        return

    if not config.is_enabled():
        logger.debug("Langfuse tracing disabled via configuration")
        return

    if not _has_required_env_vars():
        logger.debug(
            "Langfuse API keys not found - tracing disabled. Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY to enable"
        )
        return

    if not _is_langfuse_available():
        logger.debug("Langfuse package not installed - tracing disabled. Install with: pip install langfuse")
        return

    try:
        if Langfuse is None:
            raise RuntimeError("Langfuse class not available")

        _langfuse_client = Langfuse(
            public_key=os.getenv("LANGFUSE_PUBLIC_KEY"),
            secret_key=os.getenv("LANGFUSE_SECRET_KEY"),
            host=os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com"),
        )

        logger.info(f"✅ Langfuse client initialized successfully (trace_level: {config.trace_level})")
    except Exception as e:
        logger.debug(f"Failed to initialize Langfuse client: {e}")
        _langfuse_client = None


def get_langfuse_callbacks() -> list[Any]:
    """Get Langfuse callback handlers for LangChain integration.

    Returns:
        List of callback handlers, empty if Langfuse is not configured
    """
    if not _langfuse_client or not _current_config or not _current_config.is_enabled():
        logger.debug("🔍 No Langfuse callbacks: client not initialized or config disabled")
        return []

    if not _is_langfuse_available():
        logger.debug("🔍 No Langfuse callbacks: langfuse package not available")
        return []

    try:
        if CallbackHandler is None:
            raise RuntimeError("CallbackHandler not available")

        # Create callback handler with current configuration
        callback_kwargs = {}

        if _current_config.session_id:
            callback_kwargs["session_id"] = _current_config.session_id

        if _current_config.user_id:
            callback_kwargs["user_id"] = _current_config.user_id

        # Build metadata from configuration
        metadata = _current_config.metadata.copy()
        metadata.update(
            {
                "trace_level": _current_config.trace_level,
                "capture_tool_inputs": _current_config.capture_tool_inputs,
                "capture_tool_outputs": _current_config.capture_tool_outputs,
                "capture_context": _current_config.capture_context,
                "filter_sensitive_data": _current_config.filter_sensitive_data,
            }
        )

        if metadata:
            callback_kwargs["metadata"] = metadata

        handler = CallbackHandler(**callback_kwargs)
        logger.info(f"📊 Created Langfuse callback handler (session: {_current_config.session_id or 'default'})")
        return [handler]

    except Exception as e:
        logger.debug(f"Failed to create Langfuse callback handler: {e}")
        return []


def get_current_config() -> LangfuseObservabilityConfig | None:
    """Get the current Langfuse configuration."""
    return _current_config


def is_langfuse_enabled() -> bool:
    """Check if Langfuse is currently enabled and configured."""
    return _langfuse_client is not None and _current_config is not None and _current_config.is_enabled()


# Legacy compatibility - initialize with basic configuration if environment variables are present
def _initialize_legacy_compatibility():
    """Initialize Langfuse for backward compatibility if env vars are present."""
    global _langfuse_client, _current_config

    if _is_disabled_by_env():
        logger.debug("Langfuse tracing disabled via MCP_USE_LANGFUSE environment variable")
        return

    if not _has_required_env_vars():
        logger.debug(
            "Langfuse API keys not found - tracing disabled. Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY to enable"
        )
        return

    if not _is_langfuse_available():
        logger.debug("Langfuse package not installed - tracing disabled. Install with: pip install langfuse")
        return

    # Only initialize if no explicit configuration was provided
    if _current_config is None:
        default_config = LangfuseObservabilityConfig()
        configure_langfuse(default_config)
        logger.debug("Langfuse initialized with default configuration for backward compatibility")


# Legacy exports for backward compatibility
class _LegacyAccess:
    """Helper class for backward compatibility access patterns."""

    @property
    def langfuse(self):
        """Legacy property for accessing Langfuse client."""
        return _langfuse_client

    @property
    def langfuse_handler(self):
        """Legacy property for accessing Langfuse handler."""
        callbacks = get_langfuse_callbacks()
        return callbacks[0] if callbacks else None


# Create legacy access instance
_legacy = _LegacyAccess()

# Export for backward compatibility
langfuse = _legacy.langfuse
langfuse_handler = _legacy.langfuse_handler


# Initialize for backward compatibility
_initialize_legacy_compatibility()
