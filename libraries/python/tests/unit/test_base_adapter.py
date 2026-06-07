"""Unit tests for BaseAdapter result parsing and MCP content conversion."""

from mcp.types import (
    AudioContent,
    BlobResourceContents,
    CallToolResult,
    EmbeddedResource,
    ImageContent,
    TextContent,
    TextResourceContents,
)

from mcp_use.agents.adapters.base import BaseAdapter, _mcp_content_to_text


class _StubAdapter(BaseAdapter):
    """Minimal concrete adapter so the non-abstract ``parse_result`` can be exercised."""

    def _convert_tool(self, mcp_tool, connector):
        return None

    def _convert_resource(self, mcp_resource, connector):
        return None

    def _convert_prompt(self, mcp_prompt, connector):
        return None


class TestMcpContentToText:
    """Tests for the ``_mcp_content_to_text`` helper."""

    def test_single_text_content_returns_plain_string(self):
        """A single text block should be returned as a bare string."""
        result = _mcp_content_to_text([TextContent(type="text", text="hello world")])

        assert result == "hello world"

    def test_multiple_text_contents_are_joined_with_newlines(self):
        """Multiple text blocks should be preserved, not collapsed into a repr."""
        result = _mcp_content_to_text(
            [
                TextContent(type="text", text="line one"),
                TextContent(type="text", text="line two"),
            ]
        )

        assert result == "line one\nline two"

    def test_mixed_content_preserves_each_block_without_dumping_base64(self):
        """Mixed content should map to readable placeholders and never inline base64 data."""
        result = _mcp_content_to_text(
            [
                TextContent(type="text", text="intro"),
                ImageContent(type="image", data="aGVsbG8=", mimeType="image/png"),
                AudioContent(type="audio", data="d29ybGQ=", mimeType="audio/mpeg"),
                EmbeddedResource(
                    type="resource",
                    resource=TextResourceContents(uri="file:///tmp/readme.txt", text="resource text"),
                ),
                EmbeddedResource(
                    type="resource",
                    resource=BlobResourceContents(uri="file:///tmp/data.bin", blob="ZGF0YQ=="),
                ),
            ]
        )

        assert result == (
            "intro\n"
            "[image: image/png]\n"
            "[audio: audio/mpeg]\n"
            "resource text\n"
            "[resource: application/octet-stream (file:///tmp/data.bin)]"
        )
        # The raw base64 payloads must not leak into the rendered string.
        assert "aGVsbG8=" not in result
        assert "d29ybGQ=" not in result
        assert "ZGF0YQ==" not in result

    def test_empty_content_returns_empty_string(self):
        """An empty content list should render as an empty string."""
        assert _mcp_content_to_text([]) == ""

    def test_non_list_content_falls_back_to_str(self):
        """Unexpected, non-list payloads should degrade gracefully via str()."""
        assert _mcp_content_to_text("already a string") == "already a string"
        assert _mcp_content_to_text(None) == "None"


class TestParseResult:
    """Tests for ``BaseAdapter.parse_result`` using the stub adapter."""

    def test_call_tool_result_success_uses_readable_text(self):
        """A successful CallToolResult should be parsed via the content helper."""
        adapter = _StubAdapter()
        result = CallToolResult(
            content=[
                TextContent(type="text", text="caption"),
                ImageContent(type="image", data="aGVsbG8=", mimeType="image/png"),
            ]
        )

        parsed = adapter.parse_result(result)

        assert parsed == "caption\n[image: image/png]"
        assert "aGVsbG8=" not in parsed

    def test_error_result_returns_formatted_readable_error(self):
        """Error results should surface the readable error text, not a repr."""
        adapter = _StubAdapter()
        result = CallToolResult(
            content=[TextContent(type="text", text="tool blew up")],
            isError=True,
        )

        assert adapter.parse_result(result) == "Error: tool blew up"

    def test_error_result_with_empty_content_falls_back_to_unknown(self):
        """An error result with no content should report a generic message."""
        adapter = _StubAdapter()
        result = CallToolResult(content=[], isError=True)

        assert adapter.parse_result(result) == "Error: Unknown error"
