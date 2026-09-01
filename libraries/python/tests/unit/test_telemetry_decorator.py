import asyncio
import inspect
from unittest.mock import MagicMock, patch

import pytest

from mcp_use.telemetry.telemetry import telemetry


class TelemetryProbe:
    def __init__(self, record_telemetry: bool = True) -> None:
        self._record_telemetry = record_telemetry
        self.telemetry = MagicMock()

    @telemetry("async_success")
    async def wait_for(self, gate: asyncio.Event) -> str:
        await gate.wait()
        return "done"

    @telemetry("async_failure")
    async def fail(self) -> None:
        await asyncio.sleep(0)
        raise ValueError("boom")

    @telemetry("async_cancelled")
    async def wait_forever(self) -> None:
        await asyncio.Event().wait()

    @telemetry("sync_success")
    def sync_value(self) -> str:
        return "done"


@pytest.mark.asyncio
async def test_async_telemetry_is_captured_after_completion() -> None:
    probe = TelemetryProbe()
    gate = asyncio.Event()

    with patch("mcp_use.telemetry.telemetry.time") as mock_time:
        mock_time.time.side_effect = [10.0, 10.25]
        task = asyncio.create_task(probe.wait_for(gate))
        await asyncio.sleep(0)

        probe.telemetry.capture.assert_not_called()
        gate.set()
        assert await task == "done"

    event = probe.telemetry.capture.call_args.kwargs["event"]
    assert event.EVENT_NAME == "async_success"
    assert event.success is True
    assert event.execution_time_ms == 250
    assert event.error_type is None


@pytest.mark.asyncio
async def test_async_telemetry_captures_awaited_failure() -> None:
    probe = TelemetryProbe()

    with pytest.raises(ValueError, match="boom"):
        await probe.fail()

    event = probe.telemetry.capture.call_args.kwargs["event"]
    assert event.EVENT_NAME == "async_failure"
    assert event.success is False
    assert event.error_type == "ValueError"


@pytest.mark.asyncio
async def test_async_telemetry_captures_cancellation() -> None:
    probe = TelemetryProbe()
    task = asyncio.create_task(probe.wait_forever())
    await asyncio.sleep(0)

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    event = probe.telemetry.capture.call_args.kwargs["event"]
    assert event.EVENT_NAME == "async_cancelled"
    assert event.success is False
    assert event.error_type == "CancelledError"


@pytest.mark.asyncio
async def test_disabled_async_telemetry_still_awaits_function() -> None:
    probe = TelemetryProbe(record_telemetry=False)
    gate = asyncio.Event()
    gate.set()

    assert await probe.wait_for(gate) == "done"
    probe.telemetry.capture.assert_not_called()


def test_sync_telemetry_behavior_is_preserved() -> None:
    probe = TelemetryProbe()

    assert inspect.iscoroutinefunction(probe.wait_for)
    assert probe.sync_value() == "done"
    assert not inspect.iscoroutinefunction(probe.sync_value)

    event = probe.telemetry.capture.call_args.kwargs["event"]
    assert event.EVENT_NAME == "sync_success"
    assert event.success is True
