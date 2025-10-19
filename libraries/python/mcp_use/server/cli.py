import time
from typing import TYPE_CHECKING

import click

import mcp_use
from mcp_use.server.utils import estimate_tokens, get_local_network_ip

if TYPE_CHECKING:
    from mcp_use.server.server import MCPServer


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
    click.echo(f"mcp-use Version: {mcp_use.__version__}")
    click.echo()
    click.echo(f"{server.name}")
    click.echo(click.style(f"{server.instructions}", fg="bright_black"))
    click.echo(
        click.style(
            f"Tools: {len(tools)} | Resources: {len(resources)} | Prompts: {len(prompts)} | Tokens: {total_tokens}",
            fg="bright_black",
        )
    )
    click.echo()
    click.echo(f"- Local:        http://{host}:{port}")
    if network_ip and network_ip != host and host == "0.0.0.0":
        click.echo(f"- Network:      http://{get_local_network_ip()}:{port}")

    # Show additional endpoints if in dev mode
    if server.debug_level >= 1:
        click.echo(f"- Docs:         http://{host}:{port}{server.docs_url}")
        click.echo(f"- Inspector:    http://{host}:{port}{server.inspector_url}")
        click.echo(f"- OpenMCP:      http://{host}:{port}{server.openmcp_url}")

    click.echo()
    click.echo(f"{click.style('✓', fg='green')} Starting...")
    click.echo(f"{click.style('✓', fg='green')} Ready in {1000 * startup_time:.0f}ms")
    click.echo()
