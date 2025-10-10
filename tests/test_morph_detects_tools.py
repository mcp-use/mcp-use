import asyncio
import os

import pytest

from mcp_use import MCPClient

pytestmark = pytest.mark.asyncio


@pytest.mark.skipif("MORPH_API_KEY" not in os.environ, reason="MORPH_API_KEY not set")
async def test_morph_lists_tools():
    client = MCPClient.from_config_file("examples/configs/morph_fast_apply.json")
    session = await client.create_session("filesystem-with-morph")
    tools = await session.list_tools()

    try:
        assert any(getattr(t, "name", None) == "edit_file" for t in tools)
    finally:
        await client.close_all_sessions()
