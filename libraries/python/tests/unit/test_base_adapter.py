"""Unit tests for BaseAdapter.parse_result() content handling."""

from mcp.types import (
    AudioContent,
    CallToolResult,
    ImageContent,
    TextContent,
)


class TestBaseAdapterParseResult:
    """Tests for BaseAdapter.parse_result()."""

    def _create_adapter(self):
        """Create a minimal concrete adapter for testing parse_result()."""
        from mcp_use.agents.adapters.base import BaseAdapter

        class MinimalAdapter(BaseAdapter[dict]):
            framework = "test"

            def _convert_tool(self, mcp_tool, connector):
                return None

            def _convert_resource(self, mcp_resource, connector):
                return None

            def _convert_prompt(self, mcp_prompt, connector):
                return None

        return MinimalAdapter()

    def test_single_text_content_returns_plain_string(self):
        """Single TextContent should return the plain text, not a repr string."""
        adapter = self._create_adapter()
        result = CallToolResult(
            content=[TextContent(type="text", text="hello world")],
        )

        parsed = adapter.parse_result(result)

        assert parsed == "hello world"
        assert "TextContent" not in parsed

    def test_multiple_text_content_returns_newline_joined_text(self):
        """Multiple TextContent items should return newline-joined text."""
        adapter = self._create_adapter()
        result = CallToolResult(
            content=[
                TextContent(type="text", text="first line"),
                TextContent(type="text", text="second line"),
            ],
        )

        parsed = adapter.parse_result(result)

        assert parsed == "first line\nsecond line"
        assert "TextContent" not in parsed

    def test_mixed_content_text_and_image_returns_readable_output(self):
        """Mixed content with text and image should return text plus readable placeholder."""
        adapter = self._create_adapter()
        result = CallToolResult(
            content=[
                TextContent(type="text", text="Here is the image:"),
                ImageContent(type="image", data="aGVsbG8=", mimeType="image/png"),
            ],
        )

        parsed = adapter.parse_result(result)

        assert "Here is the image:" in parsed
        assert "TextContent(" not in parsed
        assert "ImageContent(" not in parsed
        # Should have some indication of the image
        assert "image" in parsed.lower() or "png" in parsed.lower()

    def test_image_only_content_returns_readable_placeholder(self):
        """Image-only content should return a readable placeholder, not repr string."""
        adapter = self._create_adapter()
        result = CallToolResult(
            content=[
                ImageContent(type="image", data="aGVsbG8=", mimeType="image/png"),
            ],
        )

        parsed = adapter.parse_result(result)

        assert "ImageContent(" not in parsed
        # Should indicate it's an image with mime type info
        assert "image" in parsed.lower() or "png" in parsed.lower()

    def test_audio_content_returns_readable_placeholder(self):
        """Audio content should return a readable placeholder, not repr string."""
        adapter = self._create_adapter()
        result = CallToolResult(
            content=[
                AudioContent(type="audio", data="d29ybGQ=", mimeType="audio/mpeg"),
            ],
        )

        parsed = adapter.parse_result(result)

        assert "AudioContent(" not in parsed
        # Should indicate it's audio with mime type info
        assert "audio" in parsed.lower() or "mpeg" in parsed.lower()

    def test_is_error_with_text_content_extracts_actual_text(self):
        """isError=True with TextContent should return 'Error: <actual text>'."""
        adapter = self._create_adapter()
        result = CallToolResult(
            content=[TextContent(type="text", text="Something went wrong")],
            isError=True,
        )

        parsed = adapter.parse_result(result)

        assert parsed == "Error: Something went wrong"
        assert "TextContent(" not in parsed
        assert "[TextContent" not in parsed

    def test_empty_content_returns_empty_string(self):
        """Empty content list should return empty string."""
        adapter = self._create_adapter()
        result = CallToolResult(
            content=[],
        )

        parsed = adapter.parse_result(result)

        assert parsed == ""
