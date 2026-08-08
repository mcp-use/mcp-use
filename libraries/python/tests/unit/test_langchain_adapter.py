"""Unit tests for LangChain adapter content conversion."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from mcp.types import (
    AudioContent,
    BlobResourceContents,
    CallToolResult,
    EmbeddedResource,
    ImageContent,
    ReadResourceResult,
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


class TestLangChainAdapterResourceTool:
    """Tests for resource tool _arun — regression for partial content loss bug."""

    def _make_resource_tool(self, read_resource_return):
        adapter = LangChainAdapter()
        connector = MagicMock()
        connector.read_resource = AsyncMock(return_value=read_resource_return)
        resource = Resource(name="test_resource", uri="config://app")
        return adapter._convert_resource(resource, connector)

    @pytest.mark.asyncio
    async def test_single_content_block_returned(self):
        """Single content block should be returned as a plain string."""
        tool = self._make_resource_tool(
            ReadResourceResult(
                contents=[TextResourceContents(uri="config://app", text="hello world")]
            )
        )
        result = await tool._arun()
        assert result == "TextContent(type='text', text='hello world')" or "hello world" in result

    @pytest.mark.asyncio
    async def test_multiple_content_blocks_all_returned(self):
        """All content blocks must be returned joined — regression for data loss bug.

        Previously only the last block was returned; the rest were silently dropped.
        """
        tool = self._make_resource_tool(
            ReadResourceResult(
                contents=[
                    TextResourceContents(uri="config://app", text="page 1"),
                    TextResourceContents(uri="config://app", text="page 2"),
                    TextResourceContents(uri="config://app", text="page 3"),
                ]
            )
        )
        result = await tool._arun()
        assert "page 1" in result
        assert "page 2" in result
        assert "page 3" in result

    @pytest.mark.asyncio
    async def test_empty_contents_returns_empty_string(self):
        """Empty contents must return empty string, not crash with UnboundLocalError.

        Previously this raised: UnboundLocalError: cannot access local variable
        'content_decoded' before assignment.
        """
        tool = self._make_resource_tool(
            ReadResourceResult(contents=[])
        )
        result = await tool._arun()
        assert result == ""


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
