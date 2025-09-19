"""
Metrics middleware for MCP contexts.

Classes for collecting comprehensive metrics about MCP context patterns,
performance, and errors with simple instantiation.
"""

import asyncio
import time
from collections import Counter, defaultdict
from typing import Any

from .middleware import Middleware, MiddlewareContext, NextFunctionT


class MetricsMiddleware(Middleware):
    """Collects basic metrics about MCP contexts including counts, durations, and errors."""

    def __init__(self):
        self.metrics = {
            "total_contexts": 0,
            "total_errors": 0,
            "method_counts": {},
            "method_durations": {},
            "active_contexts": 0,
            "start_time": time.time(),
        }
        self.lock = asyncio.Lock()

    async def on_request(self, context: MiddlewareContext[Any], call_next: NextFunctionT) -> Any:
        async with self.lock:
            self.metrics["total_contexts"] += 1
            self.metrics["active_contexts"] += 1
            self.metrics["method_counts"][context.method] = self.metrics["method_counts"].get(context.method, 0) + 1

        try:
            result = await call_next(context)
            duration = time.time() - context.timestamp

            async with self.lock:
                self.metrics["active_contexts"] -= 1
                if context.method not in self.metrics["method_durations"]:
                    self.metrics["method_durations"][context.method] = []
                self.metrics["method_durations"][context.method].append(duration)

            return result
        except Exception:
            async with self.lock:
                self.metrics["total_errors"] += 1
                self.metrics["active_contexts"] -= 1
                if context.method not in self.metrics["method_durations"]:
                    self.metrics["method_durations"][context.method] = []
                self.metrics["method_durations"][context.method].append(time.time() - context.timestamp)
            raise

    def get_metrics(self) -> dict[str, Any]:
        """Get current metrics snapshot."""
        uptime = time.time() - self.metrics["start_time"]

        return {
            **self.metrics,
            "uptime_seconds": uptime,
            "contexts_per_second": self.metrics["total_contexts"] / uptime if uptime > 0 else 0,
            "error_rate": self.metrics["total_errors"] / self.metrics["total_contexts"]
            if self.metrics["total_contexts"] > 0
            else 0,
            "method_avg_duration": {
                method: sum(durations) / len(durations) if durations else 0
                for method, durations in self.metrics["method_durations"].items()
            },
            "method_min_duration": {
                method: min(durations) if durations else 0
                for method, durations in self.metrics["method_durations"].items()
            },
            "method_max_duration": {
                method: max(durations) if durations else 0
                for method, durations in self.metrics["method_durations"].items()
            },
        }


class PerformanceMetricsMiddleware(Middleware):
    """Advanced performance metrics including percentiles, throughput, and performance trends."""

    def __init__(self):
        self.performance_data = {
            "context_times": defaultdict(list),
            "hourly_counts": defaultdict(int),
            "connector_performance": defaultdict(list),
            "slow_contexts": [],  # contexts over threshold
            "fast_contexts": [],  # Fastest contexts
            "slow_threshold_ms": 1000,  # 1 second
            "fast_threshold_ms": 50,  # 50ms
        }
        self.lock = asyncio.Lock()

    async def on_request(self, context: MiddlewareContext[Any], call_next: NextFunctionT) -> Any:
        start_time = time.time()

        try:
            result = await call_next(context)
            duration_ms = (time.time() - start_time) * 1000

            async with self.lock:
                # Track performance by method and connector
                self.performance_data["context_times"][context.method].append(duration_ms)
                self.performance_data["connector_performance"][context.connector_id].append(duration_ms)

                # Track hourly patterns
                hour = int(time.time() // 3600)
                self.performance_data["hourly_counts"][hour] += 1

                # Identify slow/fast contexts
                if duration_ms > self.performance_data["slow_threshold_ms"]:
                    self.performance_data["slow_contexts"].append(
                        {
                            "method": context.method,
                            "connector": context.connector_id,
                            "duration_ms": duration_ms,
                            "timestamp": context.timestamp,
                        }
                    )
                    # Keep only last 100 slow contexts
                    if len(self.performance_data["slow_contexts"]) > 100:
                        self.performance_data["slow_contexts"] = self.performance_data["slow_contexts"][-100:]

                if duration_ms < self.performance_data["fast_threshold_ms"]:
                    self.performance_data["fast_contexts"].append(
                        {
                            "method": context.method,
                            "connector": context.connector_id,
                            "duration_ms": duration_ms,
                            "timestamp": context.timestamp,
                        }
                    )
                    # Keep only last 100 fast contexts
                    if len(self.performance_data["fast_contexts"]) > 100:
                        self.performance_data["fast_contexts"] = self.performance_data["fast_contexts"][-100:]

            return result

        except Exception:
            # Still track duration even for failed contexts
            duration_ms = (time.time() - start_time) * 1000
            async with self.lock:
                self.performance_data["context_times"][context.method].append(duration_ms)
                self.performance_data["connector_performance"][context.connector_id].append(duration_ms)
            raise

    def get_performance_metrics(self) -> dict[str, Any]:
        """Get detailed performance statistics."""

        def calculate_percentiles(values):
            if not values:
                return {"p50": 0, "p90": 0, "p95": 0, "p99": 0}
            sorted_values = sorted(values)
            n = len(sorted_values)
            return {
                "p50": sorted_values[int(n * 0.5)],
                "p90": sorted_values[int(n * 0.9)],
                "p95": sorted_values[int(n * 0.95)],
                "p99": sorted_values[int(n * 0.99)],
            }

        method_stats = {}
        for method, times in self.performance_data["context_times"].items():
            if times:
                method_stats[method] = {
                    "count": len(times),
                    "avg_ms": sum(times) / len(times),
                    "min_ms": min(times),
                    "max_ms": max(times),
                    **calculate_percentiles(times),
                }

        connector_stats = {}
        for connector, times in self.performance_data["connector_performance"].items():
            if times:
                connector_stats[connector] = {
                    "count": len(times),
                    "avg_ms": sum(times) / len(times),
                    "min_ms": min(times),
                    "max_ms": max(times),
                    **calculate_percentiles(times),
                }

        return {
            "method_performance": method_stats,
            "connector_performance": connector_stats,
            "slow_contexts": self.performance_data["slow_contexts"][-10:],  # Last 10 slow contexts
            "fast_contexts": self.performance_data["fast_contexts"][-10:],  # Last 10 fast contexts
            "hourly_distribution": dict(self.performance_data["hourly_counts"]),
            "thresholds": {
                "slow_ms": self.performance_data["slow_threshold_ms"],
                "fast_ms": self.performance_data["fast_threshold_ms"],
            },
        }


class ErrorTrackingMiddleware(Middleware):
    """Error tracking and analysis middleware for detailed error analytics."""

    def __init__(self):
        self.error_data = {
            "error_counts": Counter(),
            "error_by_method": defaultdict(Counter),
            "error_by_connector": defaultdict(Counter),
            "recent_errors": [],
            "error_timestamps": [],
        }
        self.lock = asyncio.Lock()

    async def on_request(self, context: MiddlewareContext[Any], call_next: NextFunctionT) -> Any:
        try:
            return await call_next(context)

        except Exception as e:
            async with self.lock:
                error_type = type(e).__name__
                error_msg = str(e)

                # Track error patterns
                self.error_data["error_counts"][error_type] += 1
                self.error_data["error_by_method"][context.method][error_type] += 1
                self.error_data["error_by_connector"][context.connector_id][error_type] += 1
                self.error_data["error_timestamps"].append(time.time())

                # Keep recent errors for analysis
                error_info = {
                    "timestamp": context.timestamp,
                    "method": context.method,
                    "connector": context.connector_id,
                    "error_type": error_type,
                    "error_message": error_msg,
                    "context_id": context.id,
                }
                self.error_data["recent_errors"].append(error_info)

                # Keep only last 50 errors
                if len(self.error_data["recent_errors"]) > 50:
                    self.error_data["recent_errors"] = self.error_data["recent_errors"][-50:]

                # Keep only last 1000 timestamps
                if len(self.error_data["error_timestamps"]) > 1000:
                    self.error_data["error_timestamps"] = self.error_data["error_timestamps"][-1000:]

            raise  # Re-raise the error

    def get_error_analytics(self) -> dict[str, Any]:
        """Get detailed error analytics."""

        # Calculate error rate over time windows
        now = time.time()
        recent_errors = [t for t in self.error_data["error_timestamps"] if now - t < 3600]  # Last hour
        very_recent_errors = [t for t in self.error_data["error_timestamps"] if now - t < 300]  # Last 5 min

        return {
            "total_errors": sum(self.error_data["error_counts"].values()),
            "error_types": dict(self.error_data["error_counts"]),
            "errors_by_method": {method: dict(errors) for method, errors in self.error_data["error_by_method"].items()},
            "errors_by_connector": {
                connector: dict(errors) for connector, errors in self.error_data["error_by_connector"].items()
            },
            "recent_errors": self.error_data["recent_errors"][-10:],  # Last 10 errors
            "error_rate_last_hour": len(recent_errors),
            "error_rate_last_5min": len(very_recent_errors),
            "most_common_errors": self.error_data["error_counts"].most_common(5),
        }


class CombinedAnalyticsMiddleware(Middleware):
    """Comprehensive middleware combining metrics, performance, and error tracking."""

    def __init__(self):
        self.metrics_mw = MetricsMiddleware()
        self.perf_mw = PerformanceMetricsMiddleware()
        self.error_mw = ErrorTrackingMiddleware()

    async def on_request(self, context: MiddlewareContext[Any], call_next: NextFunctionT) -> Any:
        # Chain the middleware in the desired order: Metrics -> Errors -> Performance
        async def chain(ctx):
            # The final call in the chain is the original `call_next`
            return await self.perf_mw.on_request(ctx, call_next)

        async def error_chain(ctx):
            return await self.error_mw.on_request(ctx, chain)

        return await self.metrics_mw.on_request(context, error_chain)
        
    def get_combined_analytics(self) -> dict[str, Any]:
        """Get all analytics data in one comprehensive report."""
        return {
            "metrics": self.metrics_mw.get_metrics(),
            "performance": self.perf_mw.get_performance_metrics(),
            "errors": self.error_mw.get_error_analytics(),
            "generated_at": time.time(),
        }
