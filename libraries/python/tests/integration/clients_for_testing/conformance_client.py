"""
MCP Conformance Test Client (Python)

A client that exercises all MCP protocol features for conformance testing.
Uses MCPClient for all scenarios to validate the mcp-use client SDK.

The conformance test framework starts a test server and passes its URL as argv[1].
The scenario name is in the MCP_CONFORMANCE_SCENARIO env var.

Usage: python conformance_client.py <server_url>
"""

import asyncio
import os
import sys
import webbrowser

import httpx
from mcp.types import ElicitRequestParams, ElicitResult

from mcp_use import MCPClient

# =============================================================================
# Headless browser mock for OAuth (conformance test servers auto-approve)
# =============================================================================


def _headless_browser_open(url, *args, **kwargs):
    """Replace webbrowser.open with an HTTP GET that follows the auth URL.

    Conformance test servers auto-approve authorization requests and redirect
    back to the callback URL with the code. We just need to follow the redirect
    so the callback server captures the auth code.
    """

    async def _follow():
        async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
            await client.get(url)

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(_follow())
        else:
            loop.run_until_complete(_follow())
    except Exception:
        pass  # If it fails, the OAuth flow will timeout naturally

    return True


# Patch webbrowser.open globally so mcp-use OAuth uses headless flow
webbrowser.open = _headless_browser_open


# =============================================================================
# Elicitation callback
# =============================================================================


async def handle_elicitation(ctx, params: ElicitRequestParams) -> ElicitResult:
    """Accept elicitation requests, applying schema defaults from the server."""
    content = {}
    if hasattr(params, "requestedSchema") and params.requestedSchema:
        schema = params.requestedSchema
        properties = schema.get("properties", {}) if isinstance(schema, dict) else {}
        for field_name, field_schema in properties.items():
            if isinstance(field_schema, dict) and "default" in field_schema:
                content[field_name] = field_schema["default"]
    return ElicitResult(action="accept", content=content)


# =============================================================================
# Scenario handlers
# =============================================================================


async def run_initialize(session):
    """Just connect and initialize — the framework validates the handshake."""
    pass


async def run_tools_call(session):
    """List tools and call each one."""
    tools = await session.list_tools()
    for tool in tools:
        args = {}
        schema = tool.inputSchema or {}
        properties = schema.get("properties", {})
        for param_name, param_schema in properties.items():
            param_type = param_schema.get("type", "string")
            if param_type in ("number", "integer"):
                args[param_name] = 1
            elif param_type == "boolean":
                args[param_name] = True
            else:
                args[param_name] = "test"
        try:
            await session.call_tool(name=tool.name, arguments=args)
        except Exception:
            pass


async def run_elicitation_defaults(session):
    """Call tools — the framework checks that client returns defaults."""
    tools = await session.list_tools()
    for tool in tools:
        try:
            await session.call_tool(name=tool.name, arguments={})
        except Exception:
            pass


# =============================================================================
# Main
# =============================================================================


async def main():
    if len(sys.argv) < 2:
        print("Usage: python conformance_client.py <server_url>", file=sys.stderr)
        sys.exit(1)

    server_url = sys.argv[1]
    scenario = os.environ.get("MCP_CONFORMANCE_SCENARIO", "")

    # Build config — auth scenarios get OAuth config
    server_config: dict = {"url": server_url}
    if scenario.startswith("auth/"):
        server_config["auth"] = {}  # Trigger mcp-use OAuth discovery

    config = {"mcpServers": {"test": server_config}}
    client = MCPClient(config=config, elicitation_callback=handle_elicitation)

    try:
        await client.create_all_sessions()
        session = client.get_session("test")

        if scenario == "initialize":
            await run_initialize(session)
        elif scenario == "tools_call":
            await run_tools_call(session)
        elif scenario == "elicitation-sep1034-client-defaults":
            await run_elicitation_defaults(session)
        elif scenario == "sse-retry":
            await asyncio.sleep(5)
        elif scenario.startswith("auth/"):
            # Auth scenarios just need to connect successfully
            # The framework validates the OAuth protocol exchanges
            pass
        else:
            await run_tools_call(session)
    finally:
        await client.close_all_sessions()


if __name__ == "__main__":
    asyncio.run(main())
