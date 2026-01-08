"""
Connection management for MCP implementations.

This module provides an abstract base class for different types of connection
managers used in MCP connectors.
"""

import asyncio
from abc import ABC, abstractmethod
from typing import Generic, TypeVar

from mcp_use.logging import logger

# Type variable for connection types
T = TypeVar("T")


class ConnectionManager(Generic[T], ABC):
    """Abstract base class for connection managers.

    This class defines the interface for different types of connection managers
    used with MCP connectors.
    """

    def __init__(self) -> None:
        """Initialize a new connection manager."""
        self._ready_event = asyncio.Event()
        self._done_event = asyncio.Event()
        self._stop_event = asyncio.Event()
        self._exception: Exception | None = None
        self._connection: T | None = None
        self._task: asyncio.Task[None] | None = None

    @abstractmethod
    async def _establish_connection(self) -> T:
        """Establish the connection.

        This method should be implemented by subclasses to establish
        the specific type of connection needed.

        Returns:
            The established connection.

        Raises:
            Exception: If connection cannot be established.
        """
        pass

    @abstractmethod
    async def _close_connection(self) -> None:
        """Close the connection.

        This method should be implemented by subclasses to close
        the specific type of connection.

        """
        pass

    async def start(self) -> T:
        """Start the connection manager and establish a connection.

        Returns:
            The established connection.

        Raises:
            Exception: If connection cannot be established.
        """
        # Reset state
        self._ready_event.clear()
        self._done_event.clear()
        self._exception = None

        # Create a task to establish and maintain the connection
        self._task = asyncio.create_task(self._connection_task(), name=f"{self.__class__.__name__}_task")

        # Wait for the connection to be ready or fail
        await self._ready_event.wait()

        # If there was an exception, raise it
        if self._exception:
            raise self._exception

        # Return the connection
        if self._connection is None:
            raise RuntimeError("Connection was not established")
        return self._connection

    async def stop(self, timeout: float = 30.0) -> None:
        """Stop the connection manager and close the connection.

        This method ensures graceful shutdown by waiting for the connection task
        to complete and cleanup to finish. If operations exceed the timeout,
        forced cleanup is performed to prevent resource leaks.

        Args:
            timeout: Maximum time to wait for cleanup in seconds (default: 30.0).
                    This is the total timeout for the entire stop operation.

        Note:
            This method does not raise exceptions and guarantees graceful shutdown
            even if cleanup times out.
        """
        import time
        start_time = time.monotonic()
        
        # If stop() is called when the manager was never started, there's nothing to wait for.
        # Ensure state is consistent and return quickly to avoid long sleeps in callers/tests.
        if self._task is None:
            logger.debug(f"{self.__class__.__name__} stop() called without start(): nothing to do")
            self._connection = None
            self._done_event.set()
            return

        if self._task and not self._task.done():
            logger.debug(f"Signaling stop to {self.__class__.__name__} task")
            self._stop_event.set()

            try:
                await asyncio.wait_for(self._task, timeout=timeout)
            except TimeoutError:
                elapsed = time.monotonic() - start_time
                remaining_timeout = max(0.1, timeout - elapsed)
                
                logger.warning(f"{self.__class__.__name__} task did not stop within {timeout}s, cancelling")
                self._task.cancel()
                try:
                    await asyncio.wait_for(self._task, timeout=remaining_timeout)
                except asyncio.CancelledError:
                    logger.debug(f"{self.__class__.__name__} task cancelled successfully")
                except TimeoutError:
                    logger.error(
                        f"{self.__class__.__name__} task did not finish cancellation within {remaining_timeout}s; "
                        f"proceeding with forced shutdown"
                    )
            except asyncio.CancelledError:
                logger.debug(f"{self.__class__.__name__} task cancelled during stop")
            except Exception as e:
                logger.warning(f"Error waiting for {self.__class__.__name__} task to stop: {e}")

        # Calculate remaining time for done event wait
        elapsed = time.monotonic() - start_time
        remaining_timeout = max(0.1, timeout - elapsed)
        
        try:
            await asyncio.wait_for(self._done_event.wait(), timeout=remaining_timeout)
            logger.debug(f"{self.__class__.__name__} task completed")
        except TimeoutError:
            logger.error(
                f"Cleanup did not complete within {timeout}s total (remaining: {remaining_timeout}s). "
                f"Resources may not have been properly released for {self.__class__.__name__}. "
                f"Forcing cleanup to prevent resource leaks."
            )
            self._connection = None
            self._done_event.set()

    def get_streams(self) -> T | None:
        """Get the current connection streams.

        Returns:
            The current connection (typically a tuple of read_stream, write_stream) or None if not connected.
        """
        return self._connection

    async def _connection_task(self) -> None:
        """Run the connection task.

        This task establishes and maintains the connection until cancelled.
        """
        logger.debug(f"Starting {self.__class__.__name__} task")
        try:
            # Establish the connection
            self._connection = await self._establish_connection()
            logger.debug(f"{self.__class__.__name__} connected successfully")

            # Signal that the connection is ready
            self._ready_event.set()

            try:
                # Wait until stop is requested
                await self._stop_event.wait()
            except asyncio.CancelledError:
                # just treat this as normal shutdown and fall through to finally
                logger.debug(f"{self.__class__.__name__} task cancelled during stop")
                return

        except Exception as e:
            # Store the exception
            self._exception = e
            logger.error(f"Error in {self.__class__.__name__} task: {e}")

            # Signal that the connection is ready (with error)
            self._ready_event.set()

        finally:
            # Close the connection if it was established
            if self._connection is not None:
                try:
                    await self._close_connection()
                except Exception as e:
                    logger.warning(f"Error closing connection in {self.__class__.__name__}: {e}")
                self._connection = None

            # Signal that the connection is done
            self._done_event.set()
