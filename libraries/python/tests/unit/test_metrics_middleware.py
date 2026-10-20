"""Request accounting remains correct when MCP calls are cancelled."""

import asyncio
import time

import pytest

from mcp_use.client.middleware.metrics import CombinedAnalyticsMiddleware, MetricsMiddleware
from mcp_use.client.middleware.middleware import MiddlewareContext


def make_context(request_id: str) -> MiddlewareContext:
    return MiddlewareContext(
        id=request_id,
        method="tools/call",
        params={},
        connection_id="test",
        timestamp=time.time(),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("combined", [False, True])
async def test_cancellation_releases_only_the_cancelled_request(combined: bool) -> None:
    """A cancelled call stops being active while another call remains pending."""
    middleware = CombinedAnalyticsMiddleware() if combined else MetricsMiddleware()
    started = {name: asyncio.Event() for name in ("cancelled", "pending")}
    release = asyncio.Event()

    async def handler(context: MiddlewareContext) -> str:
        started[context.id].set()
        await release.wait()
        return "done"

    def snapshot() -> dict:
        if isinstance(middleware, CombinedAnalyticsMiddleware):
            return middleware.get_combined_analytics()["metrics"]
        return middleware.get_metrics()

    cancelled = asyncio.create_task(middleware(make_context("cancelled"), handler))
    pending = asyncio.create_task(middleware(make_context("pending"), handler))
    try:
        await asyncio.wait_for(asyncio.gather(*(event.wait() for event in started.values())), timeout=5)
        assert snapshot()["active_contexts"] == 2
        cancelled.cancel()
        with pytest.raises(asyncio.CancelledError):
            await cancelled

        metrics = snapshot()
        assert metrics["active_contexts"] == 1
        assert metrics["total_errors"] == 0
        assert len(metrics["method_durations"]["tools/call"]) == 1

        release.set()
        assert await pending == "done"
        metrics = snapshot()
        assert metrics["active_contexts"] == 0
        assert metrics["total_contexts"] == 2
        assert len(metrics["method_durations"]["tools/call"]) == 2
    finally:
        release.set()
        cancelled.cancel()
        pending.cancel()
        await asyncio.gather(cancelled, pending, return_exceptions=True)


@pytest.mark.asyncio
@pytest.mark.parametrize("fails", [False, True])
async def test_completed_requests_retain_their_outcome(fails: bool) -> None:
    """Successes and ordinary errors keep their existing accounting semantics."""
    middleware = MetricsMiddleware()

    async def handler(context: MiddlewareContext) -> str:
        if fails:
            raise ValueError("request failed")
        return "done"

    if fails:
        with pytest.raises(ValueError, match="request failed"):
            await middleware(make_context("finished"), handler)
    else:
        assert await middleware(make_context("finished"), handler) == "done"

    metrics = middleware.get_metrics()
    assert metrics["active_contexts"] == 0
    assert metrics["total_contexts"] == 1
    assert metrics["total_errors"] == int(fails)
    assert len(metrics["method_durations"]["tools/call"]) == 1
