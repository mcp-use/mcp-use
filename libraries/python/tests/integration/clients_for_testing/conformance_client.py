"""
MCP Conformance Test Client (Python)

A client that exercises all MCP protocol features for conformance testing.
The conformance test framework starts a test server and passes its URL as argv[1].
The scenario name is in the MCP_CONFORMANCE_SCENARIO env var.

Usage: python conformance_client.py <server_url>
"""

import asyncio
import os
import sys

from mcp.types import ElicitRequestParams, ElicitResult

from mcp_use import MCPClient


async def handle_elicitation(ctx, params: ElicitRequestParams) -> ElicitResult:
    """Accept elicitation requests, applying schema defaults from the server."""
    content = {}
    # Apply default values from the requested schema
    if hasattr(params, "requestedSchema") and params.requestedSchema:
        schema = params.requestedSchema
        properties = schema.get("properties", {}) if isinstance(schema, dict) else {}
        for field_name, field_schema in properties.items():
            if isinstance(field_schema, dict) and "default" in field_schema:
                content[field_name] = field_schema["default"]
    return ElicitResult(action="accept", content=content)


async def run_initialize(session):
    """Just connect and initialize — the framework validates the handshake."""
    pass  # Connection + init already happened in create_all_sessions


async def run_tools_call(session):
    """List tools and call each one."""
    tools = await session.list_tools()
    for tool in tools:
        # Build arguments from the tool's input schema
        args = {}
        schema = tool.inputSchema or {}
        properties = schema.get("properties", {})
        for param_name, param_schema in properties.items():
            param_type = param_schema.get("type", "string")
            if param_type == "number" or param_type == "integer":
                args[param_name] = 1
            elif param_type == "boolean":
                args[param_name] = True
            else:
                args[param_name] = "test"

        try:
            await session.call_tool(name=tool.name, arguments=args)
        except Exception:
            pass  # Some tools may intentionally error


async def run_elicitation_defaults(session):
    """Call the elicitation tool — the framework checks that client returns defaults."""
    tools = await session.list_tools()
    for tool in tools:
        try:
            await session.call_tool(name=tool.name, arguments={})
        except Exception:
            pass


async def main():
    if len(sys.argv) < 2:
        print("Usage: python conformance_client.py <server_url>", file=sys.stderr)
        sys.exit(1)

    server_url = sys.argv[1]
    scenario = os.environ.get("MCP_CONFORMANCE_SCENARIO", "")

    config = {"mcpServers": {"test": {"url": server_url}}}
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
        else:
            # Default: try everything
            await run_tools_call(session)

    finally:
        await client.close_all_sessions()


if __name__ == "__main__":
    asyncio.run(main())
