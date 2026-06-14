"""Pluggable code executors for MCP code mode.

Choose where agent-generated code runs:

- :class:`VMCodeExecutor` (default): in-process, fast, trusted code only. Not a
  security boundary.
- :class:`FunctionCodeExecutor`: adapt any callable into an executor.
- :class:`BaseCodeExecutor`: subclass to add a sandboxed backend (e.g. E2B).

See the package modules for details. Mirrors the TypeScript ``executors`` design.
"""

from mcp_use.client.executors.base import (
    BaseCodeExecutor,
    ExecutionResult,
    FunctionCodeExecutor,
)
from mcp_use.client.executors.vm import (
    InsecureCodeExecutionWarning,
    UnsafeCodeError,
    VMCodeExecutor,
)

__all__ = [
    "BaseCodeExecutor",
    "ExecutionResult",
    "FunctionCodeExecutor",
    "InsecureCodeExecutionWarning",
    "UnsafeCodeError",
    "VMCodeExecutor",
]
