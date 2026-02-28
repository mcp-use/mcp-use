import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from mcp_use.server.middleware.caching_middleware import ToolResultCachingMiddleware
from mcp_use.server.middleware.middleware import ServerMiddlewareContext


def create_mock_context(name: str, args: dict) -> MagicMock:
    """Helper to create a context with the correct message structure."""
    context = MagicMock(spec=ServerMiddlewareContext)
    # The middleware now reads from context.message
    context.message = MagicMock()
    context.message.name = name
    context.message.arguments = args
    return context


@pytest.mark.asyncio
async def test_caching_behavior() -> None:
    """Verify middleware serves cached results on repeated calls."""
    middleware = ToolResultCachingMiddleware(max_size=10)

    context = create_mock_context("get_stock_price", {"symbol": "AAPL"})

    mock_tool = AsyncMock(return_value={"price": 150.00})

    result1 = await middleware.on_call_tool(context, mock_tool)

    assert result1 == {"price": 150.00}
    mock_tool.assert_called_once()

    mock_tool.reset_mock()

    result2 = await middleware.on_call_tool(context, mock_tool)

    assert result2 == {"price": 150.00}
    mock_tool.assert_not_called()


@pytest.mark.asyncio
async def test_cache_key_differentiation() -> None:
    """Ensure different arguments trigger distinct tool executions."""
    middleware = ToolResultCachingMiddleware()
    mock_tool = AsyncMock(side_effect=[100, 200])

    ctx1 = create_mock_context("stock", {"symbol": "AAPL"})
    ctx2 = create_mock_context("stock", {"symbol": "GOOGL"})

    res1 = await middleware.on_call_tool(ctx1, mock_tool)
    res2 = await middleware.on_call_tool(ctx2, mock_tool)

    assert mock_tool.call_count == 2
    assert res1 == 100
    assert res2 == 200


@pytest.mark.asyncio
async def test_lru_eviction() -> None:
    """Verify that oldest items are evicted when cache limit is reached."""
    middleware = ToolResultCachingMiddleware(max_size=2)
    mock_tool = AsyncMock(side_effect=[1, 2, 3, 4])

    ctx_a = create_mock_context("tool", {"id": "A"})
    ctx_b = create_mock_context("tool", {"id": "B"})
    ctx_c = create_mock_context("tool", {"id": "C"})

    await middleware.on_call_tool(ctx_a, mock_tool)
    await middleware.on_call_tool(ctx_b, mock_tool)

    await middleware.on_call_tool(ctx_c, mock_tool)

    mock_tool.reset_mock()
    await middleware.on_call_tool(ctx_c, mock_tool)
    mock_tool.assert_not_called()  # Hit

    mock_tool.reset_mock()
    await middleware.on_call_tool(ctx_a, mock_tool)
    mock_tool.assert_called_once()  # Miss (was evicted)


@pytest.mark.asyncio
async def test_ttl_expiration() -> None:
    """Verify that cache entries expire after the TTL duration."""
    middleware = ToolResultCachingMiddleware(ttl_seconds=0.1)
    mock_tool = AsyncMock(return_value="fresh_data")

    context = create_mock_context("volatile_stock", {"symbol": "TSLA"})

    await middleware.on_call_tool(context, mock_tool)
    mock_tool.assert_called_once()

    mock_tool.reset_mock()
    await middleware.on_call_tool(context, mock_tool)
    mock_tool.assert_not_called()

    await asyncio.sleep(0.2)

    mock_tool.reset_mock()
    await middleware.on_call_tool(context, mock_tool)
    mock_tool.assert_called_once()


@pytest.mark.asyncio
async def test_concurrent_access() -> None:
    """Verify cache behaves correctly under concurrent calls (Race Condition Check)."""
    middleware = ToolResultCachingMiddleware(max_size=10)

    async def slow_tool(ctx):
        await asyncio.sleep(0.05)
        return "result"

    context = create_mock_context("concurrent_tool", {"key": "value"})

    results = await asyncio.gather(*[middleware.on_call_tool(context, slow_tool) for _ in range(5)])

    assert all(r == "result" for r in results)
