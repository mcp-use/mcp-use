import inspect
import logging
import os
import time
from typing import overload

import click
from mcp.server.fastmcp import FastMCP
from mcp.types import AnyFunction, ToolAnnotations
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse

from mcp_use.server.logging import MCP_LOGGING_CONFIG, MCPEnhancerMiddleware
from mcp_use.server.openmcp import get_openmcp_json
from mcp_use.server.utils import estimate_tokens, get_local_network_ip


async def display_startup_info(server: "MCPServer", host: str, port: int, start_time: float) -> None:
    """Display Next.js-style startup information for the MCP server."""
    # Calculate startup time
    startup_time = time.time() - start_time

    # Gather server information
    tools = await server.list_tools()
    resources = await server.list_resources()
    prompts = await server.list_prompts()

    # Calculate token estimates
    tools_tokens = sum(estimate_tokens(tool.model_dump_json()) for tool in tools)
    resources_tokens = sum(estimate_tokens(resource.model_dump_json()) for resource in resources)
    prompts_tokens = sum(estimate_tokens(prompt.model_dump_json()) for prompt in prompts)
    total_tokens = tools_tokens + resources_tokens + prompts_tokens

    # Get network IP
    network_ip = get_local_network_ip()

    # Next.js-style startup display
    click.echo("mcp-use Version: 1.3.10")
    click.echo(f"{server.name}")
    click.echo(f"{server.instructions}")
    click.echo()
    click.echo(f"Tools: {len(tools)} | Resources: {len(resources)} | Prompts: {len(prompts)} | Tokens: {total_tokens}")
    click.echo()
    click.echo(f"- Local:        http://{host}:{port}")
    if network_ip and network_ip != host:
        click.echo(f"- Network:      http://{network_ip}:{port}")

    # Show additional endpoints if in dev mode
    if server.dev_mode:
        click.echo(f"- Docs:         http://{host}:{port}/docs")
        click.echo(f"- OpenMCP:      http://{host}:{port}/openmcp.json")

    click.echo()
    click.echo(f"{click.style('✓', fg='green')} Starting...")
    click.echo(f"{click.style('✓', fg='green')} Ready in {startup_time:.1f}s")
    click.echo()


class MCPServer(FastMCP):
    def __init__(self, name: str, version: str | None = None, instructions: str | None = None, dev_mode: bool = False):
        self._start_time = time.time()  # Track startup time
        super().__init__(name=name, instructions=instructions)
        if version:
            self._mcp_server.version = version

        # Logging is now handled entirely through Uvicorn's logging system

        self.dev_mode = dev_mode
        if self.dev_mode:
            self._add_dev_routes()

        self.app = self.streamable_http_app()

        logging.getLogger("mcp.server.lowlevel.server").setLevel(logging.WARNING)

    @overload
    def add_tool(
        self,
        fn: AnyFunction,
        name: str | None = None,
        title: str | None = None,
        description: str | None = None,
        annotations: ToolAnnotations | None = None,
        structured_output: bool | None = None,
    ) -> None:
        """Add a function as a tool to the server.

        Args:
            fn: The function to register as a tool
            name: Optional name for the tool (defaults to function name)
            title: Optional human-readable title for the tool
            description: Optional description of what the tool does
            annotations: Optional ToolAnnotations providing additional tool information
            structured_output: Controls whether the tool's output is structured or unstructured
        """
        ...

    @overload
    def add_tool(
        self,
        fn: type,  # Class with __call__ method
        name: str | None = None,
        title: str | None = None,
        description: str | None = None,
        annotations: ToolAnnotations | None = None,
        structured_output: bool | None = None,
        auto_instantiate: bool = True,
    ) -> None:
        """Add a callable class as a tool to the server.

        Args:
            fn: The callable class to register as a tool
            name: Optional name for the tool (defaults to class name)
            title: Optional human-readable title for the tool
            description: Optional description of what the tool does
            annotations: Optional ToolAnnotations providing additional tool information
            structured_output: Controls whether the tool's output is structured or unstructured
            auto_instantiate: Whether to auto-instantiate the class (default: True)
        """
        ...

    @overload
    def add_tool(
        self,
        fn: object,  # Callable class instance
        name: str | None = None,
        title: str | None = None,
        description: str | None = None,
        annotations: ToolAnnotations | None = None,
        structured_output: bool | None = None,
    ) -> None:
        """Add a callable class instance as a tool to the server.

        Args:
            fn: The callable class instance to register as a tool
            name: Optional name for the tool (defaults to class name)
            title: Optional human-readable title for the tool
            description: Optional description of what the tool does
            annotations: Optional ToolAnnotations providing additional tool information
            structured_output: Controls whether the tool's output is structured or unstructured
        """
        ...

    def add_tool(
        self,
        fn: AnyFunction | object,
        name: str | None = None,
        title: str | None = None,
        description: str | None = None,
        annotations: ToolAnnotations | None = None,
        structured_output: bool | None = None,
    ) -> None:
        """Add a tool to the server.

        Supports both regular functions and callable classes (objects with __call__ method).

        Args:
            fn: The function or callable class to register as a tool
            name: Optional name for the tool (defaults to function name or class name)
            title: Optional human-readable title for the tool
            description: Optional description of what the tool does
            annotations: Optional ToolAnnotations providing additional tool information
            structured_output: Controls whether the tool's output is structured or unstructured
        """
        # Handle callable classes by using their __call__ method
        match fn:
            case fn if inspect.isclass(fn):
                # It's a class, use its __call__ method or instantiate
                instance = fn()
                actual_fn = instance.__call__
                name = name or fn.__name__
                title = title or fn.__name__
                description = description or fn.__doc__
            case fn if (
                callable(fn) and not inspect.isfunction(fn) and not inspect.ismethod(fn) and not inspect.isbuiltin(fn)
            ):
                # It's a callable class instance
                actual_fn = fn.__call__
                name = name or fn.__class__.__name__
                title = title or fn.__class__.__name__
                description = description or fn.__class__.__doc__ or fn.__call__.__doc__
            case _:
                # Regular function or method
                actual_fn = fn

        super().add_tool(
            actual_fn,
            name=name,
            title=title,
            description=description,
            annotations=annotations,
            structured_output=structured_output,
        )

    def _add_dev_routes(self):
        self.custom_route("/openmcp.json", methods=["GET"])(self._openmcp_json)
        self.custom_route("/docs", methods=["GET"])(self._docs_ui)

    def _docs_ui(self, request: Request):
        template_path = os.path.join(os.path.dirname(__file__), "templates", "docs.html")
        with open(template_path) as f:
            return HTMLResponse(f.read())

    async def _openmcp_json(self, request: Request):
        return await get_openmcp_json(self)

    def streamable_http_app(self):
        """Override to add our custom middleware."""
        app = super().streamable_http_app()

        # Add CORS middleware
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        # Add middleware to extract MCP method info
        app.add_middleware(MCPEnhancerMiddleware)

        return app

    async def run_sse_async(self, mount_path: str | None = None, reload: bool = False) -> None:
        """Run the server using SSE transport."""
        import uvicorn

        starlette_app = self.sse_app(mount_path)

        config = uvicorn.Config(
            starlette_app,
            host="0.0.0.0",  # Bind to all interfaces for network access
            port=self.settings.port,
            log_level=self.settings.log_level.lower(),
            reload=reload,
        )
        server = uvicorn.Server(config)
        await server.serve()

    async def run_streamable_http_async(self, reload: bool = False) -> None:
        """Run the server using StreamableHTTP transport."""
        import uvicorn

        starlette_app = self.streamable_http_app()

        # Display startup information (show localhost for primary URL)
        await display_startup_info(self, "localhost", self.settings.port, self._start_time)

        config = uvicorn.Config(
            starlette_app,
            host="0.0.0.0",  # Bind to all interfaces for network access
            port=self.settings.port,
            log_level=self.settings.log_level.lower(),
            reload=reload,
            log_config=MCP_LOGGING_CONFIG,
        )
        server = uvicorn.Server(config)
        await server.serve()
