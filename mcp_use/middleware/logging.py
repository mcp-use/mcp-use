"""
Default logging middleware for MCP requests.

Simple debug logging for all MCP requests and responses.
"""

import time
from typing import Any

from ..logging import logger
from .middleware import Middleware, MiddlewareContext, NextFunctionT


class LoggingMiddleware(Middleware):
    """Default logging middleware that logs all MCP requests and responses with logger.debug."""

    async def on_request(self, context: MiddlewareContext[Any], call_next: NextFunctionT) -> Any:
        """Logs all MCP requests and responses with logger.debug."""
        logger.debug(f"[{context.id}] {context.connection_id} -> {context.method}")
        try:
            result = await call_next(context)
            duration = time.time() - context.timestamp
            logger.debug(f"[{context.id}] {context.connection_id} <- {context.method} ({duration:.3f}s)")
            return result
        except Exception as e:
            duration = time.time() - context.timestamp
            logger.debug(f"[{context.id}] {context.connection_id} <- {context.method} FAILED ({duration:.3f}s): {e}")
            raise


default_logging_middleware = LoggingMiddleware()
