"""Package version and the identity sent with every batch."""

from __future__ import annotations

import platform

__version__ = "0.1.0"

SDK_NAME = "mcp-use-analytics"
_IMPLEMENTATION = platform.python_implementation().lower()
RUNTIME = f"{'python' if _IMPLEMENTATION == 'cpython' else _IMPLEMENTATION}/{platform.python_version()}"
USER_AGENT = f"{SDK_NAME}/{__version__} {RUNTIME}"
