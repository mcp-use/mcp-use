"""
Timer utility for tracking execution time.
"""

from time import perf_counter
from typing import Any


class Timer:
    """Simple timer for tracking execution time."""

    def __init__(self):
        """Initialize a new timer."""
        self.start_time: float | None = None
        self.end_time: float | None = None
        self.elapsed_time: float | None = None

    @property
    def elapsed(self) -> float:
        """Get the elapsed time in seconds.

        Returns:
            Elapsed time in seconds, or 0.0 if not started.
        """
        if self.elapsed_time is not None:
            return self.elapsed_time
        if self.start_time is not None:
            return perf_counter() - self.start_time
        return 0.0

    def start(self) -> float:
        """Start the timer.

        Returns:
            The start time.
        """
        self.start_time = perf_counter()
        self.end_time = None
        self.elapsed_time = None
        return self.start_time

    def stop(self) -> float:
        """Stop the timer.

        Returns:
            The end time.
        """
        self.end_time = perf_counter()
        if self.start_time is not None:
            self.elapsed_time = self.end_time - self.start_time
        return self.end_time

    def __enter__(self) -> "Timer":
        """Enter context manager.

        Returns:
            The timer instance.
        """
        self.start()
        return self

    def __exit__(self, *args) -> None:
        """Exit context manager.

        Args:
            *args: Exception info (if any).
        """
        self.stop()

    def to_dict(self) -> dict[str, Any]:
        """Convert timer to dictionary.

        Returns:
            Dictionary with start_time, end_time, and elapsed.
        """
        return {
            "start_time": str(self.start_time) if self.start_time is not None else None,
            "end_time": str(self.end_time) if self.end_time is not None else None,
            "elapsed": self.elapsed,
        }
