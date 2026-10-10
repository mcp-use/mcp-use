"""Resource tools should read their fixed URI and preserve every content block."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from mcp.types import BlobResourceContents, ReadResourceResult, Resource, TextResourceContents

from mcp_use.agents.adapters.langchain_adapter import LangChainAdapter
from mcp_use.client.connectors.base import BaseConnector


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "contents, expected",
    [
        ([TextResourceContents(uri="file:///notes", text="first")], "first"),
        (
            [
                TextResourceContents(uri="file:///notes", text="first"),
                TextResourceContents(uri="file:///notes", text="second"),
            ],
            "first\nsecond",
        ),
        ([], ""),
        (
            [BlobResourceContents(uri="file:///notes", blob="aGVsbG8=", mimeType="application/pdf")],
            [{"type": "file", "source_type": "base64", "data": "aGVsbG8=", "mime_type": "application/pdf"}],
        ),
    ],
)
async def test_resource_tool_accepts_empty_arguments_and_preserves_contents(contents, expected):
    connector = MagicMock(spec=BaseConnector)
    connector.read_resource = AsyncMock(return_value=ReadResourceResult(contents=contents))
    resource = Resource(name="notes", uri="file:///notes")
    tool = LangChainAdapter()._convert_resource(resource, connector)

    assert tool.args_schema.model_json_schema().get("properties") == {}
    assert await tool.ainvoke({}) == expected
    connector.read_resource.assert_awaited_once_with(resource.uri)
