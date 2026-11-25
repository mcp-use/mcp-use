"""The per-request guard that makes nested or duplicated instrumentation record once."""

from __future__ import annotations

from contextvars import ContextVar

RECORDING: ContextVar[bool] = ContextVar("mcp_use_analytics_recording", default=False)
"""True while an instrumented server is handling a request (or serving a v1
connection); anything instrumented that runs inside it, such as an in-process
proxied or mounted server, passes the request through instead of recording it
a second time."""
