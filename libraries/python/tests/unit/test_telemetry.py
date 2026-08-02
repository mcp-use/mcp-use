"""
Unit tests for the telemetry() decorator.
"""

import asyncio
from unittest.mock import MagicMock

import pytest

from mcp_use.telemetry.telemetry import telemetry


class DummyAsyncTarget:
    """A stand-in for classes like MCPSession/BaseConnector whose async methods
    are decorated with @telemetry(...)."""

    def __init__(self):
        self._record_telemetry = True
        self.telemetry = MagicMock()

    @telemetry("test_async_event")
    async def do_work(self, value: int) -> int:
        await asyncio.sleep(0.05)
        return value * 2

    @telemetry("test_async_event_error")
    async def do_fail(self) -> None:
        await asyncio.sleep(0.05)
        raise ValueError("boom")


class DummySyncTarget:
    """A stand-in for sync methods decorated with @telemetry(...), to guard
    against regressing existing sync behavior."""

    def __init__(self):
        self._record_telemetry = True
        self.telemetry = MagicMock()

    @telemetry("test_sync_event")
    def do_work(self, value: int) -> int:
        return value * 2

    @telemetry("test_sync_event_error")
    def do_fail(self) -> None:
        raise ValueError("boom")


class TestTelemetryDecoratorAsync:
    """Regression tests: the telemetry() decorator's wrapper must itself be a
    coroutine function when wrapping an async method, so the wrapped method's
    body actually runs (and can be awaited/timed/exception-caught) before the
    telemetry event is captured."""

    @pytest.mark.asyncio
    async def test_async_method_still_awaitable_and_returns_result(self):
        target = DummyAsyncTarget()

        result = await target.do_work(21)

        assert result == 42

    @pytest.mark.asyncio
    async def test_async_success_captured_after_coroutine_actually_runs(self):
        target = DummyAsyncTarget()

        await target.do_work(1)

        target.telemetry.capture.assert_called_once()
        event = target.telemetry.capture.call_args.kwargs["event"]
        assert event.EVENT_NAME == "test_async_event"
        assert event.success is True
        assert event.error_type is None
        # do_work() sleeps 50ms before returning; a wrapper that captures
        # timing before actually awaiting the coroutine would report ~0ms.
        assert event.execution_time_ms >= 40

    @pytest.mark.asyncio
    async def test_async_exception_propagates_and_is_captured(self):
        target = DummyAsyncTarget()

        with pytest.raises(ValueError, match="boom"):
            await target.do_fail()

        target.telemetry.capture.assert_called_once()
        event = target.telemetry.capture.call_args.kwargs["event"]
        assert event.EVENT_NAME == "test_async_event_error"
        assert event.success is False
        assert event.error_type == "ValueError"


class TestTelemetryDecoratorSync:
    """Regression guard: sync methods must keep working exactly as before."""

    def test_sync_success_captured(self):
        target = DummySyncTarget()

        result = target.do_work(21)

        assert result == 42
        target.telemetry.capture.assert_called_once()
        event = target.telemetry.capture.call_args.kwargs["event"]
        assert event.success is True
        assert event.error_type is None

    def test_sync_exception_propagates_and_is_captured(self):
        target = DummySyncTarget()

        with pytest.raises(ValueError, match="boom"):
            target.do_fail()

        target.telemetry.capture.assert_called_once()
        event = target.telemetry.capture.call_args.kwargs["event"]
        assert event.success is False
        assert event.error_type == "ValueError"
