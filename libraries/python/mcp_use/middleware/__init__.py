# mcp_use/middleware/__init__.py
from typing_extensions import deprecated

from mcp_use.client.middleware import (
    CallbackClientSession as _CallbackClientSession,
)
from mcp_use.client.middleware import (
    CombinedAnalyticsMiddleware as _CombinedAnalyticsMiddleware,
)
from mcp_use.client.middleware import (
    ErrorTrackingMiddleware as _ErrorTrackingMiddleware,
)
from mcp_use.client.middleware import (
    MCPResponseContext as _MCPResponseContext,
)
from mcp_use.client.middleware import (
    MetricsMiddleware as _MetricsMiddleware,
)
from mcp_use.client.middleware import (
    Middleware as _Middleware,
)
from mcp_use.client.middleware import (
    MiddlewareContext as _MiddlewareContext,
)
from mcp_use.client.middleware import (
    MiddlewareManager as _MiddlewareManager,
)
from mcp_use.client.middleware import (
    NextFunctionT as _NextFunctionT,
)
from mcp_use.client.middleware import (
    PerformanceMetricsMiddleware as _PerformanceMetricsMiddleware,
)
from mcp_use.client.middleware import (
    default_logging_middleware as _default_logging_middleware,
)


@deprecated("Use mcp_use.client.middleware.MiddlewareContext")
class MiddlewareContext(_MiddlewareContext): ...


@deprecated("Use mcp_use.client.middleware.MCPResponseContext")
class MCPResponseContext(_MCPResponseContext): ...


@deprecated("Use mcp_use.client.middleware.Middleware")
class Middleware(_Middleware): ...


@deprecated("Use mcp_use.client.middleware.MiddlewareManager")
class MiddlewareManager(_MiddlewareManager): ...


@deprecated("Use mcp_use.client.middleware.CallbackClientSession")
class CallbackClientSession(_CallbackClientSession): ...


@deprecated("Use mcp_use.client.middleware.NextFunctionT")
class NextFunctionT(_NextFunctionT): ...


@deprecated("Use mcp_use.client.middleware.default_logging_middleware")
def default_logging_middleware(*args, **kwargs):
    return _default_logging_middleware(*args, **kwargs)


@deprecated("Use mcp_use.client.middleware.MetricsMiddleware")
class MetricsMiddleware(_MetricsMiddleware): ...


@deprecated("Use mcp_use.client.middleware.PerformanceMetricsMiddleware")
class PerformanceMetricsMiddleware(_PerformanceMetricsMiddleware): ...


@deprecated("Use mcp_use.client.middleware.ErrorTrackingMiddleware")
class ErrorTrackingMiddleware(_ErrorTrackingMiddleware): ...


@deprecated("Use mcp_use.client.middleware.CombinedAnalyticsMiddleware")
class CombinedAnalyticsMiddleware(_CombinedAnalyticsMiddleware): ...
