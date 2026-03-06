"""Tests for MCPLogsOnlyFilter."""

import logging

from mcp_use.server.logging.config import MCPLogsOnlyFilter


def _make_access_record(client: str, method: str, path: str, status: int = 200) -> logging.LogRecord:
    """Create a fake uvicorn access log record with args tuple."""
    record = logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname="",
        lineno=0,
        msg='%s - "%s %s HTTP/1.1" %d',
        args=(client, method, path, "HTTP/1.1", str(status)),
        exc_info=None,
    )
    return record


class TestMCPLogsOnlyFilter:
    """Tests for MCPLogsOnlyFilter dropping uvicorn access log records."""

    def test_drops_non_mcp_request(self):
        f = MCPLogsOnlyFilter()
        record = _make_access_record("127.0.0.1:5000", "GET", "/docs")
        assert f.filter(record) is False

    def test_drops_mcp_request(self):
        """MCP access logs are dropped because MCPLoggingMiddleware prints them directly."""
        f = MCPLogsOnlyFilter()
        record = _make_access_record("127.0.0.1:5000", "POST", "/mcp")
        assert f.filter(record) is False

    def test_drops_inspector_request(self):
        f = MCPLogsOnlyFilter()
        record = _make_access_record("127.0.0.1:5000", "GET", "/inspector")
        assert f.filter(record) is False

    def test_passes_non_uvicorn_records(self):
        """Non-uvicorn log records (no args) should pass through."""
        f = MCPLogsOnlyFilter()
        record = logging.LogRecord(
            name="uvicorn.access",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="Server started",
            args=None,
            exc_info=None,
        )
        assert f.filter(record) is True
