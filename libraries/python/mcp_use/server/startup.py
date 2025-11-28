import time
from typing import TYPE_CHECKING

from rich.console import Console

import mcp_use
from mcp_use.server.types import TransportType
from mcp_use.server.utils import estimate_tokens, get_local_network_ip

if TYPE_CHECKING:
    from mcp_use.server.server import MCPServer


async def display_startup_info(
    server: "MCPServer", host: str, port: int, transport: TransportType | None = None, start_time: float = 0.0
) -> None:
    """Display Next.js-style startup information for the MCP server."""
    console = Console()
    startup_time = time.time() - start_time  # ty error: assigning float to str

    tools = await server.list_tools()
    resources = await server.list_resources()
    prompts = await server.list_prompts()

    tools_tokens = sum(estimate_tokens(tool.model_dump_json()) for tool in tools)
    resources_tokens = sum(estimate_tokens(resource.model_dump_json()) for resource in resources)
    prompts_tokens = sum(estimate_tokens(prompt.model_dump_json()) for prompt in prompts)
    total_tokens = tools_tokens + resources_tokens + prompts_tokens

    network_ip = get_local_network_ip()

    console.print(f"mcp-use Version: {mcp_use.__version__}")
    console.print()
    console.print(f"{server.name}")
    console.print(f"[bright_black]{server.instructions}[/bright_black]")
    stats = f"Tools: {len(tools)} | Resources: {len(resources)} | Prompts: {len(prompts)} | Tokens: {total_tokens}"
    console.print(f"[bright_black]{stats}[/bright_black]")
    console.print()
    console.print(f"- Transport:    {transport or 'Unknown'}")
    console.print(f"- Local:        http://{host}:{port}")
    console.print(f"- MCP:          http://{host}:{port}{server.mcp_path}")
    if network_ip and network_ip != host and host == "0.0.0.0":
        console.print(f"- Network:      http://{network_ip}:{port}")

    if server.debug_level >= 1:
        console.print(f"- Docs:         http://{host}:{port}{server.docs_path}")
        console.print(f"- Inspector:    http://{host}:{port}{server.inspector_path}")
        console.print(f"- OpenMCP:      http://{host}:{port}{server.openmcp_path}")

    console.print()
    console.print("[green]✓[/green] Starting...")
    console.print(f"[green]✓[/green] Ready in {1000 * startup_time:.0f}ms")
    console.print()
