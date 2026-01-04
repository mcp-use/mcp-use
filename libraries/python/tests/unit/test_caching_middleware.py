import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from mcp_use.server.middleware.caching_middleware import ToolResultCachingMiddleware
from mcp_use.server.middleware.middleware import ServerMiddlewareContext


@pytest.mark.asyncio
async def test_caching_behavior() -> None:
    """Verify middleware serves cached results on repeated calls."""
    middleware = ToolResultCachingMiddleware(max_size=10)

    # Create a mock context that mimics ServerMiddlewareContext
    context = MagicMock(spec=ServerMiddlewareContext)
    context.name = "get_stock_price"
    context.arguments = {"symbol": "AAPL"}

    # Mock upstream tool execution
    mock_tool = AsyncMock(return_value={"price": 150.00})

    # Call 1: Expect execution (Cache Miss)
    result1 = await middleware.on_call_tool(context, mock_tool)

    assert result1 == {"price": 150.00}
    mock_tool.assert_called_once()

    mock_tool.reset_mock()

    # Call 2: Expect cached result (Cache Hit)
    result2 = await middleware.on_call_tool(context, mock_tool)

    assert result2 == {"price": 150.00}
    mock_tool.assert_not_called()


@pytest.mark.asyncio
async def test_cache_key_differentiation() -> None:
    """Ensure different arguments trigger distinct tool executions."""
    middleware = ToolResultCachingMiddleware()
    mock_tool = AsyncMock(side_effect=[100, 200])

    # Context 1: AAPL
    ctx1 = MagicMock(spec=ServerMiddlewareContext)
    ctx1.name = "stock"
    ctx1.arguments = {"symbol": "AAPL"}

    # Context 2: GOOGL
    ctx2 = MagicMock(spec=ServerMiddlewareContext)
    ctx2.name = "stock"
    ctx2.arguments = {"symbol": "GOOGL"}

    await middleware.on_call_tool(ctx1, mock_tool)
    await middleware.on_call_tool(ctx2, mock_tool)

    assert mock_tool.call_count == 2


@pytest.mark.asyncio
async def test_lru_eviction() -> None:
    """Verify that oldest items are evicted when cache limit is reached."""
    middleware = ToolResultCachingMiddleware(max_size=2)
    mock_tool = AsyncMock(side_effect=[1, 2, 3, 4])

    # Helper to create contexts
    def make_ctx(id_val):
        c = MagicMock(spec=ServerMiddlewareContext)
        c.name = "tool"
        c.arguments = {"id": id_val}
        return c

    ctx_a = make_ctx("A")
    ctx_b = make_ctx("B")
    ctx_c = make_ctx("C")

    # Fill cache: A, B
    await middleware.on_call_tool(ctx_a, mock_tool)
    await middleware.on_call_tool(ctx_b, mock_tool)

    # Trigger eviction: Add C (A should be evicted)
    await middleware.on_call_tool(ctx_c, mock_tool)

    # Verify C is cached
    mock_tool.reset_mock()
    await middleware.on_call_tool(ctx_c, mock_tool)
    mock_tool.assert_not_called()  # Hit

    # Verify A is GONE (Miss -> Should call tool)
    mock_tool.reset_mock()
    await middleware.on_call_tool(ctx_a, mock_tool)
    mock_tool.assert_called_once()  # Miss (was evicted)


@pytest.mark.asyncio
async def test_ttl_expiration() -> None:
    """Verify that cache entries expire after the TTL duration."""
    # Initialize with a very short TTL (0.1 seconds)
    middleware = ToolResultCachingMiddleware(ttl_seconds=0.1)
    mock_tool = AsyncMock(return_value="fresh_data")

    # Manually create context
    context = MagicMock(spec=ServerMiddlewareContext)
    context.name = "volatile_stock"
    context.arguments = {"symbol": "TSLA"}

    # Call 1: Cache Miss (Data stored with timestamp)
    await middleware.on_call_tool(context, mock_tool)
    mock_tool.assert_called_once()

    # Call 2 (Immediate): Cache Hit (Data is fresh)
    mock_tool.reset_mock()
    await middleware.on_call_tool(context, mock_tool)
    mock_tool.assert_not_called()

    # Wait for TTL to expire (0.2s > 0.1s)
    await asyncio.sleep(0.2)

    # Call 3: Expired -> Should execute tool again
    mock_tool.reset_mock()
    await middleware.on_call_tool(context, mock_tool)
    mock_tool.assert_called_once()
