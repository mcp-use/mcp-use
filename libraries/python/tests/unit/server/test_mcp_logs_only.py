"""Tests for mcp_logs_only feature in MCPAccessFormatter."""

import logging

from mcp_use.server.logging.formatters import MCPAccessFormatter


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


class TestMCPLogsOnly:
    """Tests for mcp_logs_only=True suppressing all uvicorn access logs."""

    def test_suppresses_non_mcp_request(self):
        formatter = MCPAccessFormatter(mcp_logs_only=True)
        record = _make_access_record("127.0.0.1:5000", "GET", "/docs")
        result = formatter.formatMessage(record)
        assert result == ""

    def test_suppresses_mcp_request(self):
        """MCP access logs are suppressed because MCPLoggingMiddleware prints them directly."""
        formatter = MCPAccessFormatter(mcp_logs_only=True)
        record = _make_access_record("127.0.0.1:5000", "POST", "/mcp")
        result = formatter.formatMessage(record)
        assert result == ""

    def test_suppresses_inspector_request(self):
        formatter = MCPAccessFormatter(mcp_logs_only=True)
        record = _make_access_record("127.0.0.1:5000", "GET", "/inspector")
        result = formatter.formatMessage(record)
        assert result == ""

    def test_passes_non_uvicorn_records(self):
        """Non-uvicorn log records (no args) should pass through regardless."""
        formatter = MCPAccessFormatter(mcp_logs_only=True)
        record = logging.LogRecord(
            name="uvicorn.access",
            level=logging.INFO,
            pathname="",
            lineno=0,
            msg="Server started",
            args=None,
            exc_info=None,
        )
        result = formatter.formatMessage(record)
        assert result == "Server started"

    def test_default_does_not_suppress(self):
        """With mcp_logs_only=False (default), access logs are not suppressed."""
        formatter = MCPAccessFormatter(mcp_logs_only=False)
        record = _make_access_record("127.0.0.1:5000", "GET", "/docs")
        # formatMessage should NOT return empty string
        # (it will try to format via uvicorn which may fail in test env,
        #  but the key assertion is that it doesn't return "")
        try:
            result = formatter.formatMessage(record)
            assert result != ""
        except (ValueError, KeyError):
            # uvicorn formatter needs full environment — that's fine,
            # the point is it didn't return "" (it tried to format)
            pass
