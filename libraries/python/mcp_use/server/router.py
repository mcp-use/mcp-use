"""MCP Router for organizing tools, resources, and prompts into modules."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from mcp.types import ToolAnnotations


@dataclass
class PendingTool:
    """A tool waiting to be registered with a server."""

    fn: Callable[..., Any]
    name: str | None = None
    title: str | None = None
    description: str | None = None
    annotations: ToolAnnotations | None = None
    structured_output: bool | None = None


@dataclass
class PendingResource:
    """A resource waiting to be registered with a server."""

    fn: Callable[..., Any]
    uri: str
    name: str | None = None
    description: str | None = None
    mime_type: str | None = None


@dataclass
class PendingPrompt:
    """A prompt waiting to be registered with a server."""

    fn: Callable[..., Any]
    name: str | None = None
    description: str | None = None


class MCPRouter:
    """
    Router for organizing MCP tools, resources, and prompts into reusable modules.

    Similar to FastAPI's APIRouter, this allows you to define tools and resources
    in separate files and then include them in your main server.

    Example:
        ```python
        # routes/math.py
        from mcp_use.server import MCPRouter

        router = MCPRouter()

        @router.tool()
        def add(a: int, b: int) -> int:
            return a + b

        # main.py
        from mcp_use.server import MCPServer
        from routes.math import router as math_router

        server = MCPServer(name="my-server")
        server.include_router(math_router, prefix="math")
        ```
    """

    def __init__(
        self,
        *,
        prefix: str = "",
        tags: list[str] | None = None,
    ):
        """
        Create a new MCP router.

        Args:
            prefix: Optional prefix to add to all tool/resource names when included.
                    For example, prefix="math" would make tool "add" become "math_add".
            tags: Optional tags for documentation/organization purposes.
        """
        self.prefix = prefix
        self.tags = tags or []

        self._pending_tools: list[PendingTool] = []
        self._pending_resources: list[PendingResource] = []
        self._pending_prompts: list[PendingPrompt] = []

    def tool(
        self,
        name: str | None = None,
        title: str | None = None,
        description: str | None = None,
        annotations: ToolAnnotations | None = None,
        structured_output: bool | None = None,
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """
        Decorator to register a tool with this router.

        Args:
            name: Override the tool name (defaults to function name)
            title: Human-readable title for the tool
            description: Tool description (defaults to function docstring)
            annotations: MCP tool annotations
            structured_output: Whether the tool returns structured output

        Example:
            ```python
            @router.tool()
            def my_tool(arg: str) -> str:
                '''Tool description here.'''
                return f"Result: {arg}"
            ```
        """

        def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
            self._pending_tools.append(
                PendingTool(
                    fn=fn,
                    name=name,
                    title=title,
                    description=description,
                    annotations=annotations,
                    structured_output=structured_output,
                )
            )
            return fn

        return decorator

    def resource(
        self,
        uri: str,
        name: str | None = None,
        description: str | None = None,
        mime_type: str | None = None,
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """
        Decorator to register a resource with this router.

        Args:
            uri: Resource URI (required, e.g., "config://app" or "file://data.json")
            name: Human-readable name
            description: Resource description
            mime_type: MIME type of the resource content

        Example:
            ```python
            @router.resource(uri="config://app")
            def get_config() -> str:
                return '{"setting": "value"}'
            ```
        """

        def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
            self._pending_resources.append(
                PendingResource(
                    fn=fn,
                    uri=uri,
                    name=name,
                    description=description,
                    mime_type=mime_type,
                )
            )
            return fn

        return decorator

    def prompt(
        self,
        name: str | None = None,
        description: str | None = None,
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """
        Decorator to register a prompt with this router.

        Args:
            name: Prompt name (defaults to function name)
            description: Prompt description

        Example:
            ```python
            @router.prompt()
            def greeting_prompt(name: str) -> str:
                return f"Hello, {name}! How can I help you today?"
            ```
        """

        def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
            self._pending_prompts.append(
                PendingPrompt(
                    fn=fn,
                    name=name,
                    description=description,
                )
            )
            return fn

        return decorator

    def include_router(self, router: "MCPRouter", prefix: str = "") -> None:
        """
        Include another router's tools, resources, and prompts into this router.

        This allows for nested router organization.

        Args:
            router: The router to include
            prefix: Additional prefix to add to included items
        """
        combined_prefix = f"{self.prefix}_{prefix}".strip("_") if prefix else self.prefix

        for tool in router._pending_tools:
            # Apply combined prefix to tool name
            tool_name = tool.name or getattr(tool.fn, "__name__", "unknown")
            if combined_prefix:
                tool_name = f"{combined_prefix}_{tool_name}"

            self._pending_tools.append(
                PendingTool(
                    fn=tool.fn,
                    name=tool_name,
                    title=tool.title,
                    description=tool.description,
                    annotations=tool.annotations,
                    structured_output=tool.structured_output,
                )
            )

        for resource in router._pending_resources:
            self._pending_resources.append(resource)

        for prompt in router._pending_prompts:
            prompt_name = prompt.name or getattr(prompt.fn, "__name__", "unknown")
            if combined_prefix:
                prompt_name = f"{combined_prefix}_{prompt_name}"

            self._pending_prompts.append(
                PendingPrompt(
                    fn=prompt.fn,
                    name=prompt_name,
                    description=prompt.description,
                )
            )

    @property
    def tools(self) -> list[PendingTool]:
        """Get all pending tools in this router."""
        return self._pending_tools

    @property
    def resources(self) -> list[PendingResource]:
        """Get all pending resources in this router."""
        return self._pending_resources

    @property
    def prompts(self) -> list[PendingPrompt]:
        """Get all pending prompts in this router."""
        return self._pending_prompts
