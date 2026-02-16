"""Tests for Depends() dependency injection."""

from __future__ import annotations

import inspect

import pytest

from mcp_use.server.dependencies import Depends, wrap_tool_with_dependencies


def get_db():
    return "db_connection"


async def get_async_service():
    return "async_service"


def get_contextual_resource():
    yield "contextual_resource"


async def get_async_contextual():
    yield "async_contextual"


class TestDepends:
    def test_depends_stores_callable(self):
        dep = Depends(get_db)
        assert dep.dependency is get_db

    def test_depends_repr(self):
        dep = Depends(get_db)
        assert "get_db" in repr(dep)


class TestWrapToolWithDependencies:
    def test_no_depends_returns_original(self):
        def my_tool(query: str) -> str:
            return query

        result = wrap_tool_with_dependencies(my_tool)
        assert result is my_tool

    def test_signature_excludes_depends_params(self):
        def my_tool(query: str, db=Depends(get_db)) -> str:
            return f"{query} {db}"

        wrapped = wrap_tool_with_dependencies(my_tool)
        sig = inspect.signature(wrapped)
        assert "query" in sig.parameters
        assert "db" not in sig.parameters

    @pytest.mark.asyncio
    async def test_sync_dependency(self):
        def my_tool(query: str, db=Depends(get_db)) -> str:
            return f"{query} {db}"

        wrapped = wrap_tool_with_dependencies(my_tool)
        result = await wrapped(query="hello")
        assert result == "hello db_connection"

    @pytest.mark.asyncio
    async def test_async_dependency(self):
        def my_tool(query: str, svc=Depends(get_async_service)) -> str:
            return f"{query} {svc}"

        wrapped = wrap_tool_with_dependencies(my_tool)
        result = await wrapped(query="hello")
        assert result == "hello async_service"

    @pytest.mark.asyncio
    async def test_sync_generator_dependency(self):
        cleanup_called = False

        def get_resource():
            nonlocal cleanup_called
            yield "resource_value"
            cleanup_called = True

        def my_tool(query: str, res=Depends(get_resource)) -> str:
            return f"{query} {res}"

        wrapped = wrap_tool_with_dependencies(my_tool)
        result = await wrapped(query="hello")
        assert result == "hello resource_value"
        assert cleanup_called

    @pytest.mark.asyncio
    async def test_async_generator_dependency(self):
        cleanup_called = False

        async def get_resource():
            nonlocal cleanup_called
            yield "async_resource"
            cleanup_called = True

        def my_tool(query: str, res=Depends(get_resource)) -> str:
            return f"{query} {res}"

        wrapped = wrap_tool_with_dependencies(my_tool)
        result = await wrapped(query="hello")
        assert result == "hello async_resource"
        assert cleanup_called

    @pytest.mark.asyncio
    async def test_multiple_dependencies(self):
        def my_tool(query: str, db=Depends(get_db), svc=Depends(get_async_service)) -> str:
            return f"{query} {db} {svc}"

        wrapped = wrap_tool_with_dependencies(my_tool)
        result = await wrapped(query="hello")
        assert result == "hello db_connection async_service"

    @pytest.mark.asyncio
    async def test_async_tool_function(self):
        async def my_tool(query: str, db=Depends(get_db)) -> str:
            return f"{query} {db}"

        wrapped = wrap_tool_with_dependencies(my_tool)
        result = await wrapped(query="hello")
        assert result == "hello db_connection"

    def test_preserves_name_and_doc(self):
        def my_tool(query: str, db=Depends(get_db)) -> str:
            """My tool docstring."""
            return f"{query} {db}"

        wrapped = wrap_tool_with_dependencies(my_tool)
        assert wrapped.__name__ == "my_tool"
        assert wrapped.__doc__ == "My tool docstring."

    @pytest.mark.asyncio
    async def test_positional_args_work(self):
        def my_tool(query: str, db=Depends(get_db)) -> str:
            return f"{query} {db}"

        wrapped = wrap_tool_with_dependencies(my_tool)
        result = await wrapped("hello")
        assert result == "hello db_connection"
