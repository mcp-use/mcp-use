from __future__ import annotations

import functools
import inspect
from collections.abc import Callable
from typing import Any


class Depends:
    """Marks a parameter as an injected dependency.

    Usage:
        @server.tool()
        def my_tool(query: str, db: Database = Depends(get_database)) -> str:
            ...
    """

    def __init__(self, dependency: Callable[..., Any]) -> None:
        self.dependency = dependency

    def __repr__(self) -> str:
        return f"Depends({self.dependency!r})"


def wrap_tool_with_dependencies(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Wrap a tool function so that Depends() parameters are resolved at call time
    and excluded from the MCP tool schema."""
    sig = inspect.signature(fn)

    # Find params with Depends defaults
    depends_params: dict[str, Depends] = {}
    regular_params: list[inspect.Parameter] = []

    for name, param in sig.parameters.items():
        if isinstance(param.default, Depends):
            depends_params[name] = param.default
        else:
            regular_params.append(param)

    if not depends_params:
        return fn

    # Build new signature without Depends params
    new_sig = sig.replace(parameters=regular_params)

    @functools.wraps(fn)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        resolved: dict[str, Any] = {}
        cleanup_generators: list[Any] = []
        cleanup_async_generators: list[Any] = []

        try:
            # Resolve each dependency
            for param_name, dep in depends_params.items():
                result = dep.dependency()

                # Handle async callables
                if inspect.isawaitable(result):
                    result = await result

                # Handle sync generators (context manager pattern)
                if inspect.isgenerator(result):
                    value = next(result)
                    resolved[param_name] = value
                    cleanup_generators.append(result)

                # Handle async generators (async context manager pattern)
                elif inspect.isasyncgen(result):
                    value = await result.__anext__()
                    resolved[param_name] = value
                    cleanup_async_generators.append(result)

                else:
                    resolved[param_name] = result

            # Call original function with caller args + resolved deps
            kwargs.update(resolved)
            result = fn(*args, **kwargs)
            if inspect.isawaitable(result):
                result = await result
            return result
        finally:
            # Cleanup sync generators
            for gen in reversed(cleanup_generators):
                try:
                    next(gen)
                except StopIteration:
                    pass
            # Cleanup async generators
            for gen in reversed(cleanup_async_generators):
                try:
                    await gen.__anext__()
                except StopAsyncIteration:
                    pass

    wrapper.__signature__ = new_sig  # type: ignore[attr-defined]
    return wrapper
