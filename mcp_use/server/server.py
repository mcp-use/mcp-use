import inspect
import os

import click
import uvicorn
from mcp.server.fastmcp import FastMCP
from mcp.server.lowlevel.server import NotificationOptions
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse


class Server(FastMCP):
    def __init__(self, name: str, version: str | None = None, instructions: str | None = None, dev_mode: bool = False):
        super().__init__(name=name, instructions=instructions)
        if version:
            self._mcp_server.version = version

        self.dev_mode = dev_mode
        if self.dev_mode:
            self._add_dev_routes()

        self.app = self.streamable_http_app()

    def _add_dev_routes(self):
        self.custom_route("/inspector", methods=["GET"])(self._inspector)
        self.custom_route("/openmcp.json", methods=["GET"])(self._openmcp_json)

    async def _inspector(self, request: Request):
        return HTMLResponse(self._render_inspector_html())

    def _render_inspector_html(self):
        # We can later inject the correct server URL
        return """
        <!DOCTYPE html>
        <html>
        <head>
            <title>MCP Inspector</title>
            <script src="https://unpkg.com/@modelcontextprotocol/inspector@latest/dist/index.js"></script>
        </head>
        <body>
            <mcp-inspector-view server-url="/openmcp.json"></mcp-inspector-view>
        </body>
        </html>
        """

    async def _openmcp_json(self, request: Request):
        tools = await self.list_tools()
        resources = await self.list_resources()
        capabilities = self._mcp_server.get_capabilities(NotificationOptions(), experimental_capabilities={})
        prompts = await self.list_prompts()

        server_description = {
            "openmcp": "1.0",
            "info": {
                "title": self.name,
                "version": self._mcp_server.version,
                "description": self.instructions,
            },
            "capabilities": capabilities.model_dump(),
            "tools": [tool.model_dump() for tool in tools],
            "resources": [resource.model_dump() for resource in resources],
            "prompts": [prompt.model_dump() for prompt in prompts],
        }
        return JSONResponse(server_description)

    def run(self, host: str = "127.0.0.1", port: int = 8000, reload: bool = False):
        app_to_run = self.app

        if reload:
            caller_frame = inspect.stack()[1]
            caller_module = inspect.getmodule(caller_frame[0])

            if caller_module is None:
                raise RuntimeError("Could not determine the calling module. Cannot use reload=True.")

            server_variable_name = None
            for name, value in caller_module.__dict__.items():
                if value is self:
                    server_variable_name = name
                    break

            if server_variable_name is None:
                raise RuntimeError(
                    "To use reload=True, you must assign the Server instance to a"
                    " top-level variable in your main script, e.g., `server = Server(...)`."
                )

            module_name = caller_module.__name__
            if module_name == "__main__":
                module_path = caller_module.__file__
                if module_path is None:
                    raise RuntimeError("Could not determine the module file path. Cannot use reload=True.")
                filename = os.path.basename(module_path)
                module_name = os.path.splitext(filename)[0]

            app_to_run = f"{module_name}:{server_variable_name}.app"

        click.echo("🚀 Starting mcp-use server...")
        click.echo("│")
        if self.dev_mode:
            click.echo(f"├─ 🎉 Inspector: {click.style(f'http://{host}:{port}/inspector', fg='cyan')}")
            click.echo(f"├─ 📖 openmcp.json: {click.style(f'http://{host}:{port}/openmcp.json', fg='cyan')}")
        click.echo(f"└─ 🔌 Server URL: {click.style(f'http://{host}:{port}/mcp', fg='cyan')}")
        click.echo()

        uvicorn.run(app_to_run, host=host, port=port, reload=reload)
