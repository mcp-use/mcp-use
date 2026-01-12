import asyncio
import time

import pytest

from mcp_use.client.task_managers.base import ConnectionManager


class MockConnectionManager(ConnectionManager[str]):
    def __init__(
        self,
        establish_delay: float = 0,
        close_delay: float = 0,
        fail_on_establish: bool = False,
        fail_on_close: bool = False,
    ):
        super().__init__()
        self.establish_delay = establish_delay
        self.close_delay = close_delay
        self.fail_on_establish = fail_on_establish
        self.fail_on_close = fail_on_close
        self.close_called = False
        self.close_call_count = 0

    async def _establish_connection(self) -> str:
        if self.establish_delay > 0:
            await asyncio.sleep(self.establish_delay)
        if self.fail_on_establish:
            raise RuntimeError("Failed to establish connection")
        return "test_connection"

    async def _close_connection(self) -> None:
        self.close_called = True
        self.close_call_count += 1
        if self.close_delay > 0:
            await asyncio.sleep(self.close_delay)
        if self.fail_on_close:
            raise RuntimeError("Failed to close connection")


class TestConnectionManagerTimeout:
    @pytest.mark.asyncio
    async def test_stop_with_normal_cleanup(self):
        manager = MockConnectionManager()
        connection = await manager.start()
        assert connection == "test_connection"

        await manager.stop()
        assert manager.close_called

    @pytest.mark.asyncio
    async def test_stop_with_default_timeout(self):
        manager = MockConnectionManager(close_delay=0.1)
        await manager.start()

        await manager.stop()
        assert manager.close_called

    @pytest.mark.asyncio
    async def test_stop_with_custom_timeout(self):
        manager = MockConnectionManager(close_delay=0.1)
        await manager.start()

        await manager.stop(timeout=5.0)
        assert manager.close_called

    @pytest.mark.asyncio
    async def test_stop_with_slow_cleanup_exceeding_timeout(self):
        manager = MockConnectionManager(close_delay=2.0)
        await manager.start()

        await manager.stop(timeout=0.5)
        assert manager.close_called
        assert manager._connection is None

    @pytest.mark.asyncio
    async def test_stop_with_hanging_cleanup(self):
        manager = MockConnectionManager(close_delay=10.0)
        await manager.start()

        await manager.stop(timeout=0.2)
        assert manager._connection is None
        assert manager._done_event.is_set()

    @pytest.mark.asyncio
    async def test_stop_idempotent(self):
        manager = MockConnectionManager()
        await manager.start()

        # First stop
        await manager.stop()
        assert manager.close_called
        assert manager.close_call_count == 1
        assert manager._connection is None
        assert manager._done_event.is_set()
        first_task = manager._task

        # Second stop should be idempotent
        await manager.stop()
        # Verify no additional cleanup operations occurred
        assert manager.close_call_count == 1  # Should still be 1, not 2
        assert manager._connection is None
        assert manager._done_event.is_set()
        assert manager._task is first_task  # Task object should not change

    @pytest.mark.asyncio
    async def test_stop_when_task_not_started(self):
        manager = MockConnectionManager()

        start = time.monotonic()
        await manager.stop()
        elapsed = time.monotonic() - start

        # Should return quickly when not started (no 30s default wait)
        assert elapsed < 0.5, f"stop() took too long when task not started: {elapsed}s"
        assert manager._connection is None
        assert manager._done_event.is_set()

    @pytest.mark.asyncio
    async def test_stop_timeout_with_zero_timeout(self):
        manager = MockConnectionManager(close_delay=0.1)
        await manager.start()

        await manager.stop(timeout=0.01)
        assert manager._connection is None

    @pytest.mark.asyncio
    async def test_timeout_during_task_execution(self):
        manager = MockConnectionManager(close_delay=5.0)
        await manager.start()

        await manager.stop(timeout=0.1)
        assert manager._done_event.is_set()

    @pytest.mark.asyncio
    async def test_stop_without_hanging_task(self):
        manager = MockConnectionManager()
        await manager.start()
        await asyncio.sleep(0.1)

        await manager.stop(timeout=0.5)
        assert manager.close_called

    @pytest.mark.asyncio
    async def test_timeout_with_close_exception(self):
        """Test that timeout and exception handling work together correctly."""
        manager = MockConnectionManager(close_delay=5.0, fail_on_close=True)
        await manager.start()

        # Stop with short timeout - should timeout AND handle the exception
        await manager.stop(timeout=0.2)

        # Verify forced cleanup occurred
        assert manager._connection is None
        assert manager._done_event.is_set()
        # close was called but raised an exception
        assert manager.close_called

    @pytest.mark.asyncio
    async def test_close_exception_without_timeout(self):
        """Test that exceptions during close are handled gracefully without timeout."""
        manager = MockConnectionManager(close_delay=0.1, fail_on_close=True)
        await manager.start()

        # Stop with sufficient timeout - exception should be caught and logged
        await manager.stop(timeout=5.0)

        # Verify cleanup completed despite exception
        assert manager.close_called
        assert manager._connection is None
        assert manager._done_event.is_set()

    @pytest.mark.asyncio
    async def test_stop_respects_total_timeout_timing(self):
        """Ensure stop() completes within the provided total timeout (plus small epsilon)."""
        manager = MockConnectionManager(close_delay=2.0)
        await manager.start()

        timeout = 0.5
        start = time.monotonic()
        await manager.stop(timeout=timeout)
        elapsed = time.monotonic() - start

        # Allow a small scheduling epsilon
        assert elapsed <= timeout + 0.25, f"stop() took too long: {elapsed}s (timeout={timeout}s)"

        # Verify forced cleanup occurred
        assert manager._connection is None
        assert manager._done_event.is_set()

    @pytest.mark.asyncio
    async def test_stop_with_negative_timeout_waits_indefinitely(self):
        """Test that negative timeout means infinite wait (no timeout)."""
        manager = MockConnectionManager(close_delay=0.2)
        await manager.start()

        start = time.monotonic()
        # Negative timeout should wait indefinitely (no forced cleanup)
        await manager.stop(timeout=-1.0)
        elapsed = time.monotonic() - start

        # Should wait for actual cleanup (~0.2s), not timeout
        assert elapsed >= 0.15, f"stop() returned too quickly: {elapsed}s"
        assert manager.close_called
        assert manager._connection is None
        assert manager._done_event.is_set()

    @pytest.mark.asyncio
    async def test_stop_with_none_timeout_waits_indefinitely(self):
        """Test that None timeout means infinite wait (no timeout)."""
        manager = MockConnectionManager(close_delay=0.2)
        await manager.start()

        start = time.monotonic()
        # None timeout should wait indefinitely (no forced cleanup)
        await manager.stop(timeout=None)
        elapsed = time.monotonic() - start

        # Should wait for actual cleanup (~0.2s), not timeout
        assert elapsed >= 0.15, f"stop() returned too quickly: {elapsed}s"
        assert manager.close_called
        assert manager._connection is None
        assert manager._done_event.is_set()

    @pytest.mark.asyncio
    async def test_stop_with_zero_timeout_is_infinite(self):
        """Test that zero timeout means infinite wait (no timeout), not immediate timeout."""
        manager = MockConnectionManager(close_delay=0.2)
        await manager.start()

        start = time.monotonic()
        # Zero timeout should be treated as infinite (no forced cleanup)
        await manager.stop(timeout=0)
        elapsed = time.monotonic() - start

        # Should wait for actual cleanup (~0.2s), not force immediate timeout
        assert elapsed >= 0.15, f"stop() returned too quickly: {elapsed}s"
        assert manager.close_called
        assert manager._connection is None
        assert manager._done_event.is_set()
