"""Unit tests for LangChain adapter content conversion."""

import json
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

    # --- Issue #1604: empty content + structuredContent fallback ---

    def test_empty_content_with_structured_content_returns_json(self):
        """MCP 2025-11-25 servers may return empty content[] with structuredContent.
        The adapter must fall back to JSON-serialized structuredContent so that
        Bedrock (and other strict LLMs) never receive an empty tool result."""
        structured = {"success": True, "data": {"count": 3}}
        result = _mcp_content_to_langchain([], structured_content=structured)

        assert result == json.dumps(structured)

    def test_empty_content_without_structured_content_returns_placeholder(self):
        """When both content and structuredContent are absent, a non-empty
        placeholder string must be returned to avoid Bedrock ValidationException."""
        result = _mcp_content_to_langchain([])

        assert result == "(no content)"

    def test_empty_content_structured_content_none_returns_placeholder(self):
        """Explicit None for structured_content still yields the placeholder."""
        result = _mcp_content_to_langchain([], structured_content=None)

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


class TestLangChainAdapterResourceTool:
    """Tests for _convert_resource fixes (issue #1625)."""

    @pytest.mark.asyncio
    async def test_resource_tool_concatenates_multiple_content_blocks(self):
        """All content blocks must be joined; the old code silently dropped all
        but the last block, causing data loss for multi-page resources."""
        adapter = LangChainAdapter()
        connector = MagicMock()

        read_result = MagicMock()
        read_result.contents = [
            TextResourceContents(uri="file:///f", text="page 1"),
            TextResourceContents(uri="file:///f", text="page 2"),
            TextResourceContents(uri="file:///f", text="page 3"),
        ]
        connector.read_resource = AsyncMock(return_value=read_result)

        mcp_resource = Resource(uri="file:///f", name="multi_page")
        tool = adapter._convert_resource(mcp_resource, connector)
        result = await tool._arun()

        # All three blocks must be present, joined by newlines
        assert "page 1" in result
        assert "page 2" in result
        assert "page 3" in result

    @pytest.mark.asyncio
    async def test_resource_tool_returns_empty_string_for_empty_contents(self):
        """An empty contents list must return '' without raising UnboundLocalError.
        The old code crashed because content_decoded was never assigned."""
        adapter = LangChainAdapter()
        connector = MagicMock()

        read_result = MagicMock()
        read_result.contents = []
        connector.read_resource = AsyncMock(return_value=read_result)

        mcp_resource = Resource(uri="file:///empty", name="empty_resource")
        tool = adapter._convert_resource(mcp_resource, connector)
        result = await tool._arun()

        assert result == ""

    @pytest.mark.asyncio
    async def test_resource_tool_decodes_bytes_content(self):
        """Bytes content blocks must be decoded to strings before joining."""
        adapter = LangChainAdapter()
        connector = MagicMock()

        read_result = MagicMock()
        read_result.contents = [b"hello", b" world"]
        connector.read_resource = AsyncMock(return_value=read_result)

        mcp_resource = Resource(uri="file:///bytes", name="bytes_resource")
        tool = adapter._convert_resource(mcp_resource, connector)
        result = await tool._arun()

        assert "hello" in result
        assert "world" in result
