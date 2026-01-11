# mcp_use/middleware/logging.py
import warnings

from typing_extensions import deprecated

from mcp_use.client.middleware.logging import default_logging_middleware as _default_logging_middleware

warnings.warn(
    "mcp_use.middleware.logging is deprecated. "
    "Use mcp_use.client.middleware.logging. "
    "This import will be removed in version 2.0.0",
    DeprecationWarning,
    stacklevel=2,
)


@deprecated("Use mcp_use.client.middleware.logging.default_logging_middleware")
def default_logging_middleware(*args, **kwargs):
    return _default_logging_middleware(*args, **kwargs)
