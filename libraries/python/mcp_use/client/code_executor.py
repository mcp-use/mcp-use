"""Backward-compatible alias for the default in-process code executor.

The implementation now lives in :mod:`mcp_use.client.executors`. ``CodeExecutor``
remains here as a thin alias of
:class:`~mcp_use.client.executors.vm.VMCodeExecutor` so existing imports keep
working. New code should import from :mod:`mcp_use.client.executors` and select an
executor explicitly (the default in-process executor is not a security boundary;
use a sandboxed executor for untrusted code).
"""

from mcp_use.client.executors.vm import VMCodeExecutor


class CodeExecutor(VMCodeExecutor):
    """Deprecated alias of :class:`VMCodeExecutor`, kept for backwards compatibility.

    .. warning::
        In-process execution is NOT a security boundary. See
        :class:`~mcp_use.client.executors.vm.VMCodeExecutor`.
    """


__all__ = ["CodeExecutor"]
