"""
Middleware package for MCP request interception and processing.

This package provides a flexible middleware system for intercepting MCP requests
and responses, enabling logging, metrics, caching, and custom processing.

The middleware system follows an Express.js-style pattern where middleware functions
receive a request context and a call_next function, allowing them to process both
incoming requests and outgoing responses.
"""

# Core middleware implementation
# Default logging middleware
from .logging import default_logging_middleware

# Metrics middleware classes
from .metrics import (
    CombinedAnalyticsMiddleware,
    ErrorTrackingMiddleware,
    MetricsMiddleware,
    PerformanceMetricsMiddleware,
)

# Protocol types for type-safe middleware
from .middleware import (
    CallbackClientSession,
    MCPRequestContext,
    MCPResponseContext,
    MiddlewareCallbackT,
    MiddlewareManager,
    NextFunctionT,
)

__all__ = [
    # Core types and classes
    "MCPRequestContext",
    "MCPResponseContext",
    "MiddlewareManager",
    "CallbackClientSession",
    # Protocol types
    "MiddlewareCallbackT",
    "NextFunctionT",
    # Default logging middleware
    "default_logging_middleware",
    # Metrics middleware
    "MetricsMiddleware",
    "PerformanceMetricsMiddleware",
    "ErrorTrackingMiddleware",
    "CombinedAnalyticsMiddleware",
]
