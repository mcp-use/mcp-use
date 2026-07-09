"""Unit tests for the pluggable code executor architecture (issue #1718).

Covers the executor seam added alongside the in-process security fix: backward
compatibility of the legacy ``CodeExecutor`` import, executor selection on the
client, and the callable adapter.
"""

from unittest.mock import AsyncMock, MagicMock, Mock

import pytest

from mcp_use.client.client import MCPClient
from mcp_use.client.code_executor import CodeExecutor
from mcp_use.client.executors import (
    BaseCodeExecutor,
    FunctionCodeExecutor,
    VMCodeExecutor,
)


class _StubExecutor(BaseCodeExecutor):
    """Minimal executor that records calls and returns a canned result."""

    def __init__(self, client):
        super().__init__(client)
        self.calls: list[tuple[str, float]] = []

    async def execute(self, code, timeout=30.0):
        self.calls.append((code, timeout))
        return {"result": "stub", "logs": [], "error": None, "execution_time": 0.0}


class TestBackwardCompatibility:
    """The legacy ``CodeExecutor`` import path keeps working."""

    def test_code_executor_is_vm_subclass(self):
        assert issubclass(CodeExecutor, VMCodeExecutor)

    def test_code_executor_instantiable(self):
        executor = CodeExecutor(MagicMock())
        assert isinstance(executor, BaseCodeExecutor)


class TestExecutorSelection:
    """``code_executor`` selects which executor runs agent code."""

    def test_default_resolves_to_vm(self):
        client = MCPClient(code_mode=True)
        assert isinstance(client._resolve_code_executor(), VMCodeExecutor)

    def test_vm_string_resolves_to_vm(self):
        client = MCPClient(code_mode=True, code_executor="vm")
        assert isinstance(client._resolve_code_executor(), VMCodeExecutor)

    def test_instance_used_as_is(self):
        client = MCPClient(code_mode=True)
        stub = _StubExecutor(client)
        client._code_executor_spec = stub
        assert client._resolve_code_executor() is stub

    @pytest.mark.asyncio
    async def test_execute_code_delegates_to_custom_instance(self):
        client = MCPClient(code_mode=True)
        stub = _StubExecutor(client)
        client._code_executor_spec = stub

        result = await client.execute_code("return 1")

        assert result["result"] == "stub"
        assert stub.calls and stub.calls[0][0] == "return 1"

    @pytest.mark.asyncio
    async def test_callable_wrapped_in_function_executor(self):
        seen = {}

        def my_exec(code, timeout):
            seen["code"] = code
            return {"result": "fn", "logs": [], "error": None, "execution_time": 0.1}

        client = MCPClient(code_mode=True, code_executor=my_exec)
        assert isinstance(client._resolve_code_executor(), FunctionCodeExecutor)

        result = await client.execute_code("return 2")

        assert result["result"] == "fn"
        assert seen["code"] == "return 2"

    def test_subclass_instantiated_with_client(self):
        client = MCPClient(code_mode=True, code_executor=_StubExecutor)
        executor = client._resolve_code_executor()
        assert isinstance(executor, _StubExecutor)
        assert executor.client is client

    def test_invalid_executor_raises(self):
        client = MCPClient(code_mode=True, code_executor=123)
        with pytest.raises(ValueError, match="Invalid code_executor"):
            client._resolve_code_executor()


class TestFunctionCodeExecutor:
    """The callable adapter supports sync and async callables."""

    @pytest.mark.asyncio
    async def test_sync_callable(self):
        def fn(code, timeout):
            return {"result": code.upper(), "logs": [], "error": None, "execution_time": 0.0}

        executor = FunctionCodeExecutor(MagicMock(), fn)
        result = await executor.execute("abc", 5.0)

        assert result["result"] == "ABC"

    @pytest.mark.asyncio
    async def test_async_callable(self):
        async def fn(code, timeout):
            return {"result": "async", "logs": [], "error": None, "execution_time": 0.0}

        executor = FunctionCodeExecutor(MagicMock(), fn)
        result = await executor.execute("x", 5.0)

        assert result["result"] == "async"


class TestBaseExecutorHelpers:
    """Shared helpers on BaseCodeExecutor behave correctly."""

    @pytest.mark.asyncio
    async def test_search_tools_function(self):
        client = MagicMock()
        session = AsyncMock()
        tool = Mock()
        tool.name = "do_thing"
        tool.description = "does a thing"
        tool.inputSchema = {}
        session.list_tools = AsyncMock(return_value=[tool])
        client.sessions = {"srv": session}

        executor = _StubExecutor(client)
        search = executor.create_search_tools_function()
        result = await search("")

        assert result["meta"]["total_tools"] == 1
        assert result["meta"]["namespaces"] == ["srv"]
        assert result["results"][0]["name"] == "do_thing"

    @pytest.mark.asyncio
    async def test_cleanup_is_noop_by_default(self):
        executor = _StubExecutor(MagicMock())
        # Should not raise.
        assert await executor.cleanup() is None
