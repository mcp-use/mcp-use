import asyncio

import pytest

from mcp_use.client.task_managers.base import ConnectionManager


class MockConnectionManager(ConnectionManager[str]):
    def __init__(self, establish_delay: float = 0, close_delay: float = 0, fail_on_establish: bool = False):
        super().__init__()
        self.establish_delay = establish_delay
        self.close_delay = close_delay
        self.fail_on_establish = fail_on_establish
        self.close_called = False

    async def _establish_connection(self) -> str:
        if self.establish_delay > 0:
            await asyncio.sleep(self.establish_delay)
        if self.fail_on_establish:
            raise RuntimeError("Failed to establish connection")
        return "test_connection"

    async def _close_connection(self) -> None:
        self.close_called = True
        if self.close_delay > 0:
            await asyncio.sleep(self.close_delay)


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

        await manager.stop()
        await manager.stop()

    @pytest.mark.asyncio
    async def test_stop_when_task_not_started(self):
        manager = MockConnectionManager()
        await manager.stop()

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
