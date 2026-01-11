import inspect
import logging
import socket
from typing import Any, get_type_hints

logger = logging.getLogger(__name__)


def estimate_tokens(text: str) -> int:
    """Rough estimate of token count (approximately 4 characters per token)."""
    return max(1, len(str(text)) // 4)


def get_local_network_ip() -> str | None:
    """Get the local network IP address."""
    try:
        # Connect to a remote address to determine local IP
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError as exc:
        logger.debug("Failed to determine local network IP: %s", exc)
        return None


def get_return_type(func_or_callable) -> type:
    """Get the return type annotation from a function or callable class."""
    if inspect.isclass(func_or_callable):
        # It's a class, get return type from __call__ method
        if callable(func_or_callable):
            call_method = func_or_callable.__call__
            return get_return_type(call_method)
        return Any
    elif (
        callable(func_or_callable)
        and not inspect.isfunction(func_or_callable)
        and not inspect.ismethod(func_or_callable)
        and not inspect.isbuiltin(func_or_callable)
    ):
        # It's a callable class instance, get return type from __call__ method
        return get_return_type(func_or_callable.__call__)
    else:
        # It's a regular function
        try:
            # Try get_type_hints first (handles forward references)
            hints = get_type_hints(func_or_callable)
            return hints.get("return", Any)
        except (NameError, AttributeError):
            # Fallback to inspect.signature
            try:
                sig = inspect.signature(func_or_callable)
                return sig.return_annotation if sig.return_annotation != inspect.Signature.empty else Any
            except (ValueError, TypeError):
                return Any
