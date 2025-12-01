"""
Unit tests for BaseConnectionManager (ConnectionManager).
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_use.client.task_managers.base import ConnectionManager


class MockConnectionManager(ConnectionManager[str]):
    """Mock implementation of ConnectionManager for testing."""

    def __init__(self, connection_result: str = "test_connection", should_fail: bool = False):
        """Initialize mock connection manager.

        Args:
            connection_result: The connection object to return
            should_fail: If True, raise an exception during connection
        """
        super().__init__()
        self.connection_result = connection_result
        self.should_fail = should_fail
        self.establish_called = False
        self.close_called = False

    async def _establish_connection(self) -> str:
        """Mock connection establishment."""
        self.establish_called = True
        if self.should_fail:
            raise ConnectionError("Connection failed")
        await asyncio.sleep(0.01)  # Simulate async work
        return self.connection_result

    async def _close_connection(self) -> None:
        """Mock connection closure."""
        self.close_called = True
        await asyncio.sleep(0.01)  # Simulate async work


class TestConnectionManagerInitialization:
    """Tests for ConnectionManager initialization."""

    def test_init(self):
        """Test that ConnectionManager initializes correctly."""
        manager = MockConnectionManager()

        assert manager._ready_event is not None
        assert manager._done_event is not None
        assert manager._stop_event is not None
        assert manager._exception is None
        assert manager._connection is None
        assert manager._task is None

    def test_get_streams_before_connection(self):
        """Test get_streams returns None before connection."""
        manager = MockConnectionManager()
        assert manager.get_streams() is None


class TestConnectionManagerConnectionLifecycle:
    """Tests for connection lifecycle management."""

    @pytest.mark.asyncio
    async def test_start_establishes_connection(self):
        """Test that start() establishes a connection."""
        manager = MockConnectionManager(connection_result="test_conn")

        connection = await manager.start()

        assert connection == "test_conn"
        assert manager._connection == "test_conn"
        assert manager.establish_called is True
        assert manager._ready_event.is_set()
        assert manager._task is not None

    @pytest.mark.asyncio
    async def test_start_raises_exception_on_failure(self):
        """Test that start() raises exception when connection fails."""
        manager = MockConnectionManager(should_fail=True)

        with pytest.raises(ConnectionError, match="Connection failed"):
            await manager.start()

        assert manager.establish_called is True
        assert manager._exception is not None
        assert isinstance(manager._exception, ConnectionError)

    @pytest.mark.asyncio
    async def test_start_resets_state(self):
        """Test that start() resets state properly."""
        manager = MockConnectionManager()

        # Set events manually to simulate previous state
        manager._ready_event.set()
        manager._done_event.set()
        manager._exception = ValueError("Previous error")

        await manager.start()

        # State should be reset
        assert manager._exception is None
        assert manager._connection == "test_connection"

    @pytest.mark.asyncio
    async def test_stop_closes_connection(self):
        """Test that stop() closes the connection."""
        manager = MockConnectionManager()

        await manager.start()
        await manager.stop()

        assert manager.close_called is True
        assert manager._connection is None
        assert manager._done_event.is_set()

    @pytest.mark.asyncio
    async def test_stop_waits_for_task_completion(self):
        """Test that stop() waits for task to complete."""
        manager = MockConnectionManager()

        await manager.start()
        task = manager._task

        await manager.stop()

        assert task.done() is True

    @pytest.mark.asyncio
    async def test_stop_handles_already_stopped(self):
        """Test that stop() handles already stopped manager."""
        manager = MockConnectionManager()

        await manager.start()
        await manager.stop()

        # Stop again should not raise
        await manager.stop()

        assert manager.close_called is True

    @pytest.mark.asyncio
    async def test_stop_without_start(self):
        """Test that stop() works even if start() was never called."""
        manager = MockConnectionManager()

        # Should not raise
        await manager.stop()

        assert manager._done_event.is_set()

    @pytest.mark.asyncio
    async def test_full_lifecycle(self):
        """Test complete connection lifecycle: connect → use → disconnect."""
        manager = MockConnectionManager(connection_result="my_connection")

        # Connect
        connection = await manager.start()
        assert connection == "my_connection"
        assert manager.get_streams() == "my_connection"

        # Use connection
        assert manager._connection is not None

        # Disconnect
        await manager.stop()
        assert manager.get_streams() is None
        assert manager.close_called is True


class TestConnectionManagerErrorHandling:
    """Tests for error handling."""

    @pytest.mark.asyncio
    async def test_connection_error_propagated(self):
        """Test that connection errors are propagated."""
        manager = MockConnectionManager(should_fail=True)

        with pytest.raises(ConnectionError):
            await manager.start()

        assert manager._exception is not None

    @pytest.mark.asyncio
    async def test_close_error_logged_not_raised(self):
        """Test that errors during close are logged but not raised."""
        manager = MockConnectionManager()

        # Override close to raise an error
        async def failing_close():
            raise RuntimeError("Close failed")

        manager._close_connection = failing_close

        await manager.start()

        # Stop should not raise, even if close fails
        with patch("mcp_use.client.task_managers.base.logger") as mock_logger:
            await manager.stop()

        # Error should be logged
        mock_logger.warning.assert_called()

    @pytest.mark.asyncio
    async def test_establish_error_stored(self):
        """Test that establishment errors are stored."""
        manager = MockConnectionManager(should_fail=True)

        try:
            await manager.start()
        except ConnectionError:
            pass

        assert manager._exception is not None
        assert isinstance(manager._exception, ConnectionError)


class TestConnectionManagerTaskManagement:
    """Tests for task management."""

    @pytest.mark.asyncio
    async def test_task_created_on_start(self):
        """Test that a task is created when start() is called."""
        manager = MockConnectionManager()

        assert manager._task is None

        await manager.start()

        assert manager._task is not None
        assert manager._task.get_name() == "MockConnectionManager_task"

    @pytest.mark.asyncio
    async def test_task_completes_on_stop(self):
        """Test that task completes when stop() is called."""
        manager = MockConnectionManager()

        await manager.start()
        task = manager._task

        await manager.stop()

        assert task.done() is True

    @pytest.mark.asyncio
    async def test_stop_event_signals_task(self):
        """Test that stop event signals the task to stop."""
        manager = MockConnectionManager()

        await manager.start()

        # Task should be waiting on stop_event
        assert not manager._stop_event.is_set()

        await manager.stop()

        # Stop event should be set
        assert manager._stop_event.is_set()


class TestConnectionManagerConcurrency:
    """Tests for concurrent operations."""

    @pytest.mark.asyncio
    async def test_multiple_starts_sequential(self):
        """Test that multiple sequential starts work correctly."""
        manager = MockConnectionManager()

        conn1 = await manager.start()
        await manager.stop()

        conn2 = await manager.start()
        await manager.stop()

        assert conn1 == conn2 == "test_connection"
        assert manager.establish_called is True

    @pytest.mark.asyncio
    async def test_get_streams_during_connection(self):
        """Test get_streams() behavior during connection."""
        manager = MockConnectionManager()

        # Before start
        assert manager.get_streams() is None

        # During start (before ready)
        start_task = asyncio.create_task(manager.start())

        # Give it a moment to start establishing
        await asyncio.sleep(0.005)

        # Connection might not be ready yet
        # After start completes
        await start_task
        assert manager.get_streams() == "test_connection"

        # After stop
        await manager.stop()
        assert manager.get_streams() is None
