import pytest
from mcp import ClientSession
from mcp.server.lowlevel import Server
from mcp.shared.memory import create_connected_server_and_client_session
from mcp.types import (
    ListPromptsRequest,
    ListPromptsResult,
    ListResourcesRequest,
    ListResourcesResult,
    ListToolsRequest,
    ListToolsResult,
    Prompt,
    Resource,
    Tool,
)

from mcp_use.client.connectors.base import BaseConnector


class MemoryConnector(BaseConnector):
    def __init__(self, session: ClientSession):
        super().__init__()
        self.client_session = session
        self._record_telemetry = False

    async def connect(self) -> None:
        self._connected = True

    @property
    def public_identifier(self) -> str:
        return "memory-pagination"


def paginated_server() -> Server:
    server = Server("paginated")

    @server.list_tools()
    async def tools(request: ListToolsRequest) -> ListToolsResult:
        cursor = request.params.cursor if request.params else None
        if cursor is None:
            return ListToolsResult(tools=[Tool(name="first", inputSchema={"type": "object"})], nextCursor="opaque:next")
        assert cursor == "opaque:next"
        return ListToolsResult(tools=[Tool(name="second", inputSchema={"type": "object"})])

    @server.list_resources()
    async def resources(request: ListResourcesRequest) -> ListResourcesResult:
        cursor = request.params.cursor if request.params else None
        if cursor is None:
            # Empty pages may still have a continuation cursor.
            return ListResourcesResult(resources=[], nextCursor="opaque:next")
        assert cursor == "opaque:next"
        return ListResourcesResult(resources=[Resource(name="second", uri="memory://second")])

    @server.list_prompts()
    async def prompts(request: ListPromptsRequest) -> ListPromptsResult:
        cursor = request.params.cursor if request.params else None
        if cursor is None:
            return ListPromptsResult(prompts=[Prompt(name="first")], nextCursor="opaque:next")
        assert cursor == "opaque:next"
        return ListPromptsResult(prompts=[Prompt(name="second")])

    return server


@pytest.mark.asyncio
@pytest.mark.parametrize("initialize", [False, True])
@pytest.mark.parametrize(
    "kind, names", [("tools", ["first", "second"]), ("resources", ["second"]), ("prompts", ["first", "second"])]
)
async def test_lists_and_initial_discovery_follow_pagination(kind, names, initialize):
    async with create_connected_server_and_client_session(paginated_server()) as session:
        connector = MemoryConnector(session)
        await connector.connect()
        if initialize:
            await connector.initialize()
            with pytest.warns(DeprecationWarning):
                cached = getattr(connector, kind)
            assert [item.name for item in cached] == names
        items = await getattr(connector, f"list_{kind}")()
        assert [item.name for item in items] == names


@pytest.mark.asyncio
async def test_unpaginated_server_keeps_a_single_request():
    server = Server("single-page")
    calls = 0

    @server.list_tools()
    async def tools() -> list[Tool]:
        nonlocal calls
        calls += 1
        return [Tool(name="only", inputSchema={"type": "object"})]

    async with create_connected_server_and_client_session(server) as session:
        connector = MemoryConnector(session)
        await connector.connect()
        assert [item.name for item in await connector.list_tools()] == ["only"]
        assert calls == 1
