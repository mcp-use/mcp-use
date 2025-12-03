# mcp_use/middleware/metrics.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.middleware.metrics import (
    CombinedAnalyticsMiddleware as _CombinedAnalyticsMiddleware,
)
from mcp_use.client.middleware.metrics import (
    ErrorTrackingMiddleware as _ErrorTrackingMiddleware,
)
from mcp_use.client.middleware.metrics import (
    MetricsMiddleware as _MetricsMiddleware,
)
from mcp_use.client.middleware.metrics import (
    PerformanceMetricsMiddleware as _PerformanceMetricsMiddleware,
)

warnings.warn(
    "mcp_use.middleware.metrics is deprecated. "
    "Use mcp_use.client.middleware.metrics. "
    "This import will be removed in version 2.0.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.middleware.metrics.CombinedAnalyticsMiddleware")
class CombinedAnalyticsMiddleware(_CombinedAnalyticsMiddleware): ...


@deprecated("Use mcp_use.client.middleware.metrics.ErrorTrackingMiddleware")
class ErrorTrackingMiddleware(_ErrorTrackingMiddleware): ...


@deprecated("Use mcp_use.client.middleware.metrics.MetricsMiddleware")
class MetricsMiddleware(_MetricsMiddleware): ...


@deprecated("Use mcp_use.client.middleware.metrics.PerformanceMetricsMiddleware")
class PerformanceMetricsMiddleware(_PerformanceMetricsMiddleware): ...
