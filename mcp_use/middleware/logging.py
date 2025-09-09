"""
Default logging middleware for MCP requests.

Simple debug logging for all MCP requests and responses.
"""

import time
from typing import Any

from ..logging import logger
from .middleware import MCPRequestContext, NextFunctionT


async def default_logging_middleware(request: MCPRequestContext, call_next: NextFunctionT) -> Any:
    """Default logging middleware that logs all MCP requests and responses with logger.debug."""
    logger.debug(f"[{request.id}] {request.connector_id} -> {request.method}")

    try:
        result = await call_next()
        duration = time.time() - request.timestamp
        logger.debug(f"[{request.id}] {request.connector_id} <- {request.method} ({duration:.3f}s)")
        return result
    except Exception as e:
        duration = time.time() - request.timestamp
        logger.debug(f"[{request.id}] {request.connector_id} <- {request.method} FAILED ({duration:.3f}s): {e}")
        raise
