import asyncio
import hashlib
import json
import logging
import time
from collections import OrderedDict
from collections.abc import Callable
from typing import Any

from .middleware import Middleware, ServerMiddlewareContext

logger = logging.getLogger(__name__)


class ToolResultCachingMiddleware(Middleware):
    """Tool that remembers previous answers to avoid doing the same work twice.

    Implementing LRU eviction to limit memory usage. Intercepts tool execution requests and serves cached results
    for identical inputs, reducing redundant API calls and system latency.
    """

    def __init__(self, max_size: int = 1000, ttl_seconds: float = 300.0) -> None:
        """Initialize caching middleware.

        Args:
            max_size: Maximum number of entries to retain in the cache. Defaults to 1000.
            ttl_seconds: Time to live in seconds. Entries older than this are expired. Defaults to 300.
        """
        super().__init__()
        self._max_size = max_size
        self._ttl_seconds = ttl_seconds
        self._cache: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._cache_lock = asyncio.Lock()

    def _generate_cache_key(self, tool_name: str, arguments: dict[str, Any]) -> str:
        """Generate deterministic SHA-256 hash for tool call.

        Args:
            tool_name: Name of tool being executed.
            arguments: Dictionary of arguments passed to the tool.

        Returns:
            A SHA-256 hash string, as the unique cache key.
        """
        # sort_keys=True guarantees {"a": 1, "b": 2} == {"b": 2, "a": 1}
        try:
            payload = json.dumps(arguments, sort_keys=True, default=str)
        except Exception:
            logger.warning("Failed to serialize arguments for tool %s, using empty payload", tool_name)
            payload = ""

        key_content = f"{tool_name}:{payload}"
        return hashlib.sha256(key_content.encode()).hexdigest()

    async def on_call_tool(
        self, context: ServerMiddlewareContext, call_next: Callable[[ServerMiddlewareContext], Any]
    ) -> Any:
        """Intercept tool calls to return cached results or execute and cache.

        Args:
            context: Execution context containing tool name and arguments.
            call_next: Next middleware or execution handler in the chain.

        Returns:
            Result of tool execution, cached or fresh.
        """
        # Correctly access name and arguments from the message object
        if hasattr(context, "message") and context.message:
            tool_name = getattr(context.message, "name", "unknown_tool")
            args = getattr(context.message, "arguments", {})
        else:
            tool_name = "unknown_tool"
            args = {}

        cache_key = self._generate_cache_key(tool_name, args)
        current_time = time.time()

        async with self._cache_lock:
            if cache_key in self._cache:
                cached_result, timestamp = self._cache[cache_key]

                # Check if expired
                if current_time - timestamp < self._ttl_seconds:
                    # Hit: Move to MRU and return
                    self._cache.move_to_end(cache_key)
                    logger.debug("Cache hit for tool: %s", tool_name)
                    return cached_result
                else:
                    # Expired: Delete
                    del self._cache[cache_key]

        try:
            logger.debug("Cache miss for tool: %s", tool_name)
            result = await call_next(context)
        except Exception:
            logger.exception("Tool execution failed for %s", tool_name)
            raise

        async with self._cache_lock:
            self._cache[cache_key] = (result, current_time)
            self._cache.move_to_end(cache_key)

            if len(self._cache) > self._max_size:
                # Evict oldest (FIFO behavior for LRU)
                self._cache.popitem(last=False)

        return result
