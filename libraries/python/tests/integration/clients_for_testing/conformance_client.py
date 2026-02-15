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
from urllib.parse import parse_qs, urlparse

import httpx
from mcp.client.auth import OAuthClientProvider
from mcp.client.auth.oauth2 import OAuthClientMetadata
from mcp.types import ElicitRequestParams, ElicitResult

from mcp_use import MCPClient

# =============================================================================
# Headless OAuth provider for conformance test servers (auto-approve)
# =============================================================================


class InMemoryTokenStorage:
    """Simple in-memory token storage for conformance tests."""

    def __init__(self):
        self._tokens = {}

    async def get_tokens(self):
        return self._tokens.get("default")

    async def set_tokens(self, tokens):
        self._tokens["default"] = tokens

    async def get_client_info(self):
        return self._tokens.get("client_info")

    async def set_client_info(self, client_info):
        self._tokens["client_info"] = client_info


def create_headless_oauth_provider(server_url: str) -> OAuthClientProvider:
    """Create an OAuthClientProvider that handles auth headlessly.

    Conformance test servers auto-approve authorization requests, so the
    redirect_handler follows the auth URL via httpx (instead of opening a browser)
    and the callback_handler extracts the code from the redirect.

    This is passed directly to MCPClient as an httpx.Auth instance.
    """
    auth_code_future: asyncio.Future | None = None

    async def redirect_handler(authorization_url: str) -> None:
        nonlocal auth_code_future
        auth_code_future = asyncio.get_event_loop().create_future()

        try:
            async with httpx.AsyncClient(follow_redirects=False) as client:
                response = await client.get(authorization_url)

                if response.status_code in (301, 302, 303, 307, 308):
                    redirect_url = str(response.headers["location"])
                    parsed = urlparse(redirect_url)
                    params = parse_qs(parsed.query)
                    code = params.get("code", [None])[0]
                    state = params.get("state", [None])[0]
                    if code:
                        auth_code_future.set_result((code, state))
                        return

            auth_code_future.set_exception(Exception("No auth code in redirect"))
        except Exception as e:
            if auth_code_future and not auth_code_future.done():
                auth_code_future.set_exception(e)

    async def callback_handler() -> tuple[str, str | None]:
        if auth_code_future is None:
            raise Exception("redirect_handler was not called")
        return await auth_code_future

    return OAuthClientProvider(
        server_url=server_url,
        client_metadata=OAuthClientMetadata(
            client_name="mcp-use-conformance-client",
            redirect_uris=["http://127.0.0.1:19823/callback"],
            grant_types=["authorization_code", "refresh_token"],
            response_types=["code"],
            token_endpoint_auth_method="client_secret_post",
        ),
        storage=InMemoryTokenStorage(),
        redirect_handler=redirect_handler,
        callback_handler=callback_handler,
        timeout=10.0,
    )


# =============================================================================
# Elicitation callback
# =============================================================================


async def handle_elicitation(_ctx, params: ElicitRequestParams) -> ElicitResult:
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


async def run_initialize(_session):
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

    # Build config — auth scenarios pass a headless OAuthClientProvider as httpx.Auth
    server_config: dict = {"url": server_url}
    if scenario.startswith("auth/"):
        server_config["auth"] = create_headless_oauth_provider(server_url)

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
            pass  # The framework validates OAuth protocol exchanges
        else:
            await run_tools_call(session)
    finally:
        await client.close_all_sessions()


if __name__ == "__main__":
    asyncio.run(main())
