"""Signal handling for graceful server shutdown."""


def setup_signal_handlers():
    """Set up signal handlers for server shutdown.

    Note:
        Currently a no-op. uvicorn handles SIGINT/SIGTERM gracefully.
        This function exists for potential future customization.
    """
    # uvicorn already handles SIGINT (Ctrl+C) and SIGTERM gracefully.
    # No custom signal handling needed.
    pass
