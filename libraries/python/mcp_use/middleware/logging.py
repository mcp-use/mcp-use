# mcp_use/middleware/logging.py
from typing_extensions import deprecated

from mcp_use.client.middleware.logging import default_logging_middleware as _default_logging_middleware


@deprecated("Use mcp_use.client.middleware.logging.default_logging_middleware")
def default_logging_middleware(*args, **kwargs):
    return _default_logging_middleware(*args, **kwargs)
