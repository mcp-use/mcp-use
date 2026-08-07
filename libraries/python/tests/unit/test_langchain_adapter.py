"""Unit tests for LangChain adapter content conversion."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from mcp.types import (
    AudioContent,
    BlobResourceContents,
    CallToolResult,
    EmbeddedResource,
    ImageContent,
    TextContent,
    TextResourceContents,
    Tool,
)

from mcp_use.agents.adapters.langchain_adapter import LangChainAdapter, _mcp_content_to_langchain


class TestLangChainAdapterContentConversion:
    """Tests for MCP-to-LangChain content conversion."""

    def test_single_text_content_returns_plain_string(self):
        """Single text results should preserve the simple string contract."""
        result = _mcp_content_to_langchain(
            CallToolResult(content=[TextContent(type="text", text="hello world")])
        )

        assert result == "hello world"

    def test_mixed_content_returns_langchain_blocks(self):
        """Mixed content should map to LangChain block dictionaries."""
        result = _mcp_content_to_langchain(
            CallToolResult(
                content=[
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
        )

        assert result == [
            {"type": "text", "text": "intro"},
            {
                "type": "image",
                "source_type": "base64",
                "data": "aGVsbG8=",
                "mime_type": "image/png",
            },
            {
                "type": "audio",
                "source_type": "base64",
                "data": "d29ybGQ=",
                "mime_type": "audio/mpeg",
            },
            {"type": "text", "text": "resource text"},
            {
                "type": "file",
                "source_type": "base64",
                "data": "ZGF0YQ==",
                "mime_type": "application/octet-stream",
            },
        ]

    def test_unknown_embedded_resource_falls_back_to_text(self):
        """Unexpected embedded resource payloads should not be dropped silently."""
        result = _mcp_content_to_langchain(
            CallToolResult(
                content=[
                    EmbeddedResource.model_construct(
                        type="resource",
                        resource={"unexpected": "value"},
                    )
                ]
            )
        )

        assert result == "{'unexpected': 'value'}"

    def test_empty_content_with_structured_content_returns_json(self):
        """Empty content[] with structuredContent should return JSON string instead of empty string.

        Regression test for https://github.com/mcp-use/mcp-use/issues/1604
        Bedrock rejects empty string ToolMessages, so we fall back to structuredContent.
        """
        result = _mcp_content_to_langchain(
            CallToolResult(
                content=[],
                structuredContent={"success": True, "data": {"value": 42}},
            )
        )

        import json
        assert result == json.dumps({"success": True, "data": {"value": 42}})

    def test_empty_content_without_structured_content_returns_placeholder(self):
        """Empty content[] with no structuredContent should return a non-empty placeholder.

        Regression test for https://github.com/mcp-use/mcp-use/issues/1604
        Bedrock rejects empty string ToolMessages.
        """
        result = _mcp_content_to_langchain(
            CallToolResult(content=[], structuredContent=None)
        )

        assert result == "(no content)"
        assert result != ""


class TestLangChainAdapterToolExecution:
    """Tests for LangChain tool execution behavior."""

    @pytest.mark.asyncio
    async def test_error_call_tool_result_returns_formatted_error(self):
        """MCP error results should be surfaced as structured LangChain tool errors."""
        adapter = LangChainAdapter()
        connector = MagicMock()
        connector.call_tool = AsyncMock(
            return_value=CallToolResult(
                content=[TextContent(type="text", text="tool failed")],
                isError=True,
            )
        )

        tool = Tool(
            name="failing_tool",
            description="A tool that fails",
            inputSchema={"type": "object", "properties": {}},
        )
        langchain_tool = adapter._convert_tool(tool, connector)

        assert langchain_tool is not None

        result = await langchain_tool._arun()

        connector.call_tool.assert_awaited_once_with("failing_tool", {})
        assert result["error"] == "RuntimeError"
        assert result["details"] == "tool failed"
        assert result["tool"] == "failing_tool"
        assert result["tool_content"] == "tool failed"
