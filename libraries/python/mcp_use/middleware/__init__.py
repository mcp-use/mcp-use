"""Middleware package for MCP request interception and processing.

Re-exports from ``mcp_use.client.middleware`` for ergonomic top-level access::

    from mcp_use.middleware import LoggingMiddleware, PerformanceMetricsMiddleware
"""

# Core middleware types
from mcp_use.client.middleware import (
    CallbackClientSession,
    CombinedAnalyticsMiddleware,
    ErrorTrackingMiddleware,
    MCPResponseContext,
    MetricsMiddleware,
    Middleware,
    MiddlewareContext,
    MiddlewareManager,
    NextFunctionT,
    PerformanceMetricsMiddleware,
    default_logging_middleware,
)

# Built-in middleware classes
from mcp_use.client.middleware.logging import LoggingMiddleware

__all__ = [
    # Core types and classes
    "MiddlewareContext",
    "MCPResponseContext",
    "Middleware",
    "MiddlewareManager",
    "CallbackClientSession",
    # Protocol types
    "NextFunctionT",
    # Built-in middleware
    "LoggingMiddleware",
    "default_logging_middleware",
    # Metrics middleware
    "MetricsMiddleware",
    "PerformanceMetricsMiddleware",
    "ErrorTrackingMiddleware",
    "CombinedAnalyticsMiddleware",
]
