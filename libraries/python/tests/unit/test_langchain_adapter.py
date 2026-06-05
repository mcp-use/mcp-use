"""Unit tests for LangChain adapter content conversion."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from mcp.types import (
    AudioContent,
    BlobResourceContents,
    CallToolResult,
    EmbeddedResource,
    ImageContent,
    Resource,
    TextContent,
    TextResourceContents,
    Tool,
)

from mcp_use.agents.adapters.langchain_adapter import LangChainAdapter, _mcp_content_to_langchain


class TestLangChainAdapterContentConversion:
    """Tests for MCP-to-LangChain content conversion."""

    def test_single_text_content_returns_plain_string(self):
        """Single text results should preserve the simple string contract."""
        result = _mcp_content_to_langchain([TextContent(type="text", text="hello world")])

        assert result == "hello world"

    def test_mixed_content_returns_langchain_blocks(self):
        """Mixed content should map to LangChain block dictionaries."""
        result = _mcp_content_to_langchain(
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
            [
                EmbeddedResource.model_construct(
                    type="resource",
                    resource={"unexpected": "value"},
                )
            ]
        )

        assert result == "{'unexpected': 'value'}"

    def test_empty_content_uses_structured_content(self):
        """Structured tool results should not become empty LangChain tool messages."""
        result = _mcp_content_to_langchain(
            [],
            structured_content={"success": True, "data": {"value": 42}},
        )

        assert result == '{"success": true, "data": {"value": 42}}'

    def test_empty_content_without_structured_content_returns_placeholder(self):
        """Empty tool results need non-empty text for providers that reject blank tool messages."""
        result = _mcp_content_to_langchain([])

        assert result == "(no content)"


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

    @pytest.mark.asyncio
    async def test_empty_tool_content_returns_structured_content(self):
        """Tool execution should preserve structuredContent when content is empty."""
        adapter = LangChainAdapter()
        connector = MagicMock()
        connector.call_tool = AsyncMock(
            return_value=CallToolResult(
                content=[],
                structuredContent={"success": True, "data": {"value": 42}},
                isError=False,
            )
        )

        tool = Tool(
            name="structured_tool",
            description="A tool that returns structured content",
            inputSchema={"type": "object", "properties": {}},
        )
        langchain_tool = adapter._convert_tool(tool, connector)

        assert langchain_tool is not None

        result = await langchain_tool._arun()

        connector.call_tool.assert_awaited_once_with("structured_tool", {})
        assert result == '{"success": true, "data": {"value": 42}}'


class TestLangChainAdapterResourceExecution:
    """Tests for LangChain resource tool execution behavior."""

    @pytest.mark.asyncio
    async def test_resource_tool_returns_all_content_blocks(self):
        """Resource tools should not silently drop all but the final content block."""
        adapter = LangChainAdapter()
        connector = MagicMock()
        connector.read_resource = AsyncMock(
            return_value=MagicMock(
                contents=[
                    TextResourceContents(uri="file:///tmp/report.txt", text="page 1"),
                    TextResourceContents(uri="file:///tmp/report.txt", text="page 2"),
                    BlobResourceContents(uri="file:///tmp/report.bin", blob="cGFnZSAz"),
                ]
            )
        )
        resource = Resource.model_construct(
            uri="file:///tmp/report.txt",
            name="report",
            description="A multi-part report",
        )
        langchain_resource = adapter._convert_resource(resource, connector)

        result = await langchain_resource._arun()

        connector.read_resource.assert_awaited_once_with("file:///tmp/report.txt")
        assert result == "page 1\npage 2\ncGFnZSAz"

    @pytest.mark.asyncio
    async def test_resource_tool_returns_empty_string_for_empty_contents(self):
        """Resource tools should handle empty content lists gracefully."""
        adapter = LangChainAdapter()
        connector = MagicMock()
        connector.read_resource = AsyncMock(return_value=MagicMock(contents=[]))
        resource = Resource.model_construct(
            uri="file:///tmp/empty.txt",
            name="empty",
            description="An empty resource",
        )
        langchain_resource = adapter._convert_resource(resource, connector)

        result = await langchain_resource._arun()

        connector.read_resource.assert_awaited_once_with("file:///tmp/empty.txt")
        assert result == ""
