"""
Internal asyncio compatibility module for Python 3.10.

This module patches asyncio.run to ensure MCP cleanup happens before
the event loop closes, preventing "Event loop is closed" errors in Python 3.10.
"""

import asyncio
import sys
from collections.abc import Coroutine
from typing import Any, TypeVar

T = TypeVar("T")

# Store the original asyncio.run
_original_asyncio_run = asyncio.run

# Store original BaseSubprocessTransport.__del__ if it exists
_original_subprocess_del = None
if sys.version_info[:2] == (3, 10):
    try:
        from asyncio.base_subprocess import BaseSubprocessTransport

        _original_subprocess_del = BaseSubprocessTransport.__del__
    except (ImportError, AttributeError):
        pass


#
def _patched_asyncio_run(main: Coroutine[Any, Any, T], *, debug: bool = None) -> T:
    """
    Patched version of asyncio.run that ensures MCP cleanup before loop closes.

    This is only needed for Python 3.10 to prevent "Event loop is closed" errors
    when subprocess transports try to cleanup in __del__ methods.
    """

    async def wrapped():
        try:
            return await main
        finally:
            # Force cleanup of all MCP sessions before the loop closes
            import gc

            from .client import MCPClient
            from .connectors.stdio import StdioConnector
            from .session import MCPSession

            # Find and cleanup any MCP clients
            for obj in gc.get_objects():
                if isinstance(obj, MCPClient) and obj.sessions:
                    try:
                        await obj.close_all_sessions()
                    except Exception:
                        pass

            # Force cleanup of any remaining sessions
            for obj in gc.get_objects():
                if isinstance(obj, MCPSession):
                    try:
                        await obj.disconnect()
                    except Exception:
                        pass

            # Force cleanup of any stdio connectors and their processes
            from .task_managers.stdio import StdioConnectionManager

            for obj in gc.get_objects():
                if isinstance(obj, StdioConnector) and hasattr(obj, "_connection_manager"):
                    try:
                        if obj._connection_manager and hasattr(obj._connection_manager, "process"):
                            proc = obj._connection_manager.process
                            if proc and proc.returncode is None:
                                proc.kill()  # Use kill instead of terminate
                    except Exception:
                        pass
                elif isinstance(obj, StdioConnectionManager) and hasattr(obj, "process"):
                    try:
                        proc = obj.process
                        if proc and proc.returncode is None:
                            proc.kill()
                    except Exception:
                        pass

            # Force garbage collection
            gc.collect()

    return _original_asyncio_run(wrapped(), debug=debug)


def _safe_subprocess_del(self):
    """Safe version of BaseSubprocessTransport.__del__ that doesn't raise on closed loop."""
    try:
        if hasattr(self._loop, "_closed") and self._loop._closed:
            # Don't try to close if the loop is already closed
            return
        if _original_subprocess_del:
            _original_subprocess_del(self)
    except RuntimeError as e:
        if "Event loop is closed" not in str(e):
            raise
        # Silently ignore "Event loop is closed" errors


def patch_asyncio_run():
    """Apply the asyncio.run patch for Python 3.10 compatibility."""
    if sys.version_info[:2] == (3, 10):
        asyncio.run = _patched_asyncio_run

        # Also patch BaseSubprocessTransport.__del__ to prevent errors
        try:
            from asyncio.base_subprocess import BaseSubprocessTransport

            BaseSubprocessTransport.__del__ = _safe_subprocess_del
        except (ImportError, AttributeError):
            pass


def unpatch_asyncio_run():
    """Remove the asyncio.run patch."""
    asyncio.run = _original_asyncio_run
