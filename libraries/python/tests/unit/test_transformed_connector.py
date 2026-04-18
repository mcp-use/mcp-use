import pytest
from unittest.mock import AsyncMock, MagicMock
from mcp.types import Tool, CallToolResult
from mcp_use.client.connectors.transformed import TransformedConnector, Transforms
from mcp_use.client.connectors.base import BaseConnector
from mcp_use.client.middleware import Middleware

class DummyConnector(BaseConnector):
    def __init__(self):
        super().__init__()
        self.list_tools_mock = AsyncMock(return_value=[])
        self.call_tool_mock = AsyncMock(return_value=CallToolResult(content=[], isError=False))

    async def connect(self): pass
    async def disconnect(self): pass
    @property
    def public_identifier(self): return "dummy:connector"
    async def list_tools(self): return await self.list_tools_mock()
    async def call_tool(self, name, arguments, read_timeout_seconds=None):
        return await self.call_tool_mock(name, arguments, read_timeout_seconds)

@pytest.mark.asyncio
async def test_transformed_connector_prefix():
    inner = DummyConnector()
    inner.list_tools_mock.return_value = [
        Tool(name="calculate", description="Calc", inputSchema={"type": "object", "properties": {}})
    ]
    
    # Wrap with prefix
    connector = TransformedConnector(inner, Transforms(prefix="math"))
    
    # Test list_tools
    tools = await connector.list_tools()
    assert len(tools) == 1
    assert tools[0].name == "math_calculate"
    
    # Test call_tool
    await connector.call_tool("math_calculate", {"a": 1})
    inner.call_tool_mock.assert_called_once_with("calculate", {"a": 1}, None)

@pytest.mark.asyncio
async def test_transformed_connector_filtering():
    inner = DummyConnector()
    inner.list_tools_mock.return_value = [
        Tool(name="get", description="Get", inputSchema={"type": "object", "properties": {}}),
        Tool(name="delete", description="Delete", inputSchema={"type": "object", "properties": {}})
    ]
    
    # Allow only "get"
    connector = TransformedConnector(inner, Transforms(allowed_tools=["get"]))
    tools = await connector.list_tools()
    assert len(tools) == 1
    assert tools[0].name == "get"
    
    # Try calling forbidden tool
    with pytest.raises(ValueError, match="not allowed"):
        await connector.call_tool("delete", {})
    
    # Disallowed "delete"
    connector = TransformedConnector(inner, Transforms(disallowed_tools=["delete"]))
    tools = await connector.list_tools()
    assert len(tools) == 1
    assert tools[0].name == "get"

@pytest.mark.asyncio
async def test_chaining():
    inner = DummyConnector()
    inner.list_tools_mock.return_value = [
        Tool(name="tool", description="Tool", inputSchema={"type": "object", "properties": {}})
    ]
    
    # with_prefix returns TransformedConnector
    connector = inner.with_prefix("api").with_prefix("v1")
    assert isinstance(connector, TransformedConnector)
    assert connector.transforms.prefix == "api_v1"
    
    tools = await connector.list_tools()
    assert tools[0].name == "api_v1_tool"

@pytest.mark.asyncio
async def test_middleware_execution():
    inner = DummyConnector()
    
    mw_called = False
    
    class MockMiddleware(Middleware):
        async def on_call_tool(self, context, call_next):
            nonlocal mw_called
            mw_called = True
            return await call_next(context)
            
    connector = inner.with_middleware([MockMiddleware()])
    await connector.call_tool("some_tool", {})
    
    assert mw_called is True
    inner.call_tool_mock.assert_called_once()
