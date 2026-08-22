"""
Unit tests for error_formatting.

Covers:
- format_error returns expected dict shape
- Logs at DEBUG level (not ERROR) — avoids double-logging since callers already log
"""

from unittest.mock import patch

import pytest

from mcp_use.errors.error_formatting import format_error


class TestFormatError:
    def test_returns_dict_with_required_keys(self):
        err = ValueError("something went wrong")
        result = format_error(err)

        assert result["error"] == "ValueError"
        assert result["details"] == "something went wrong"
        assert "stack" in result
        assert "code" in result

    def test_extra_context_included(self):
        err = RuntimeError("oops")
        result = format_error(err, server="my_server", tool="my_tool")

        assert result["server"] == "my_server"
        assert result["tool"] == "my_tool"

    def test_error_with_code_attribute(self):
        class CodedError(Exception):
            code = "E42"

        err = CodedError("coded error")
        result = format_error(err)
        assert result["code"] == "E42"

    def test_error_without_code_attribute_defaults_unknown(self):
        err = ValueError("plain")
        result = format_error(err)
        assert result["code"] == "UNKNOWN"

    def test_logs_at_debug_not_error(self):
        """format_error must use logger.debug, not logger.error.

        Using logger.error here caused every structured error to appear
        in production logs twice (once here, once at the call site).
        """
        err = TypeError("type mismatch")
        with patch("mcp_use.errors.error_formatting.logger") as mock_logger:
            format_error(err)

        mock_logger.debug.assert_called_once()
        mock_logger.error.assert_not_called()
