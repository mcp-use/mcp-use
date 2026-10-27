"""Non-string MCP enum values must survive LangChain argument validation."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from mcp.types import CallToolResult, TextContent, Tool

from mcp_use.agents.adapters.langchain_adapter import LangChainAdapter


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("values", "value"),
    [
        ([1, 2], 1),
        ([1.5, 2.5], 1.5),
        ([True, False], False),
        (["ready", None], None),
        (["ready", 0], 0),
        (["ready", "done"], "ready"),
    ],
)
async def test_enum_argument_reaches_connector_without_type_coercion(values, value):
    connector = MagicMock()
    connector.call_tool = AsyncMock(return_value=CallToolResult(content=[TextContent(type="text", text="ok")]))
    tool = LangChainAdapter()._convert_tool(
        Tool(
            name="choose",
            inputSchema={
                "type": "object",
                "properties": {"choice": {"enum": values}},
                "required": ["choice"],
            },
        ),
        connector,
    )

    assert tool is not None
    assert await tool.ainvoke({"choice": value}) == "ok"
    connector.call_tool.assert_awaited_once_with("choose", {"choice": value})
    assert type(connector.call_tool.call_args.args[1]["choice"]) is type(value)
