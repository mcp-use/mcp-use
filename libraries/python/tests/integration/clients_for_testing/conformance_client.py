"""
MCP Conformance Test Client (Python)

This script is the test subject for the official MCP client conformance suite.
It validates that the mcp-use Python client SDK correctly implements the MCP
protocol by exercising MCPClient against test servers started by the conformance
framework.

How it works:
    The conformance framework (https://github.com/modelcontextprotocol/conformance)
    starts a purpose-built test server for each scenario, then runs this script with:
    - argv[1]: the test server's URL
    - MCP_CONFORMANCE_SCENARIO: which scenario to run (e.g., "initialize", "auth/scope-step-up")
    - MCP_CONFORMANCE_CONTEXT: JSON with scenario-specific data (e.g., pre-registered credentials)

    The framework monitors all HTTP traffic between this client and its test server,
    then validates that the protocol exchanges match the MCP specification.

    Each scenario's expected behavior is defined in the conformance repo:
    https://github.com/modelcontextprotocol/conformance/tree/main/src/scenarios/client

Scenario reference:
    Core scenarios:
    - initialize: Just connect. The framework validates the handshake (protocol version,
      client info, capabilities).
    - tools_call: List tools, call each one. The test server exposes an add_numbers tool
      and checks that the client invokes it correctly.
    - elicitation-sep1034-client-defaults: The server requests elicitation with a schema
      that has default values. The client must return those defaults.
      Ref: https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1034
    - sse-retry: The test server exposes a test_reconnection tool that closes the SSE
      stream. The client must reconnect via GET with the Last-Event-ID header.
      Ref: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports

    Auth scenarios (all start with "auth/"):
    - Most auth scenarios: Connect with OAuth. The framework validates the full OAuth flow
      (PRM discovery, auth server metadata, DCR or CIMD, authorization, token exchange).
    - auth/basic-cimd: Server advertises client_id_metadata_document_supported=true.
      Client must use a URL-based client_id instead of DCR. The conformance test expects
      the specific URL "https://conformance-test.local/client-metadata.json".
      Ref: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#client-id-metadata-documents
    - auth/scope-step-up: After initial auth with mcp:basic scope, calling tools/call
      returns 403 insufficient_scope requiring mcp:write. Client must re-authorize.
      The httpx auth flow handles this automatically — we just need to call tools.
      Ref: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#scope-challenge-handling
    - auth/pre-registration: MCP_CONFORMANCE_CONTEXT provides {"client_id": "...",
      "client_secret": "..."}. Client must use these instead of doing DCR.
      Ref: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#preregistration

    For all auth scenarios, after authenticating we call tools to exercise the
    connection — this is required for scope-step-up (triggers the 403 re-auth)
    and validates that the token works for actual MCP operations.

Usage: python conformance_client.py <server_url>
"""

import asyncio
import json
import os
import sys
from urllib.parse import parse_qs, urlparse

import httpx
from mcp.client.auth import OAuthClientProvider
from mcp.client.auth.oauth2 import OAuthClientMetadata
from mcp.shared.auth import OAuthClientInformationFull
from mcp.types import ElicitRequestParams, ElicitResult

from mcp_use import MCPClient

REDIRECT_URI = "http://127.0.0.1:19823/callback"


# =============================================================================
# Headless OAuth provider for conformance test servers
# =============================================================================
#
# The conformance test servers auto-approve authorization requests (no real
# browser interaction needed). We replace the browser-based OAuth flow with
# an httpx-based one that follows the authorization redirect programmatically.
#
# This is passed to MCPClient as an httpx.Auth instance via the server config's
# "auth" key. The HttpConnector._set_auth() accepts httpx.Auth directly and
# passes it to the httpx client used by the MCP transport.


class InMemoryTokenStorage:
    """Simple in-memory token storage for conformance tests."""

    def __init__(self):
        self._tokens = {}
        self._client_info = None

    async def get_tokens(self):
        return self._tokens.get("default")

    async def set_tokens(self, tokens):
        self._tokens["default"] = tokens

    async def get_client_info(self):
        return self._client_info

    async def set_client_info(self, client_info):
        self._client_info = client_info


def create_headless_oauth_provider(
    server_url: str,
    *,
    client_id: str | None = None,
    client_secret: str | None = None,
    client_metadata_url: str | None = None,
) -> OAuthClientProvider:
    """Create an OAuthClientProvider that completes OAuth flows without a browser.

    The conformance test servers auto-approve authorization requests and redirect
    back with the auth code. Instead of opening a browser, the redirect_handler
    follows the authorization URL via httpx and captures the code from the redirect.

    Args:
        server_url: The MCP server URL being tested.
        client_id: Pre-registered client ID (for auth/pre-registration scenario).
            Sourced from MCP_CONFORMANCE_CONTEXT.
        client_secret: Pre-registered client secret (for auth/pre-registration).
            Sourced from MCP_CONFORMANCE_CONTEXT.
        client_metadata_url: URL-based client ID for CIMD (for auth/basic-cimd).
            The conformance test expects "https://conformance-test.local/client-metadata.json".
    """
    auth_code_future: asyncio.Future | None = None

    async def redirect_handler(authorization_url: str) -> None:
        """Follow the authorization URL headlessly instead of opening a browser."""
        nonlocal auth_code_future
        loop = asyncio.get_running_loop()
        auth_code_future = loop.create_future()

        try:
            async with httpx.AsyncClient(follow_redirects=False) as http_client:
                response = await http_client.get(authorization_url)

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
        """Return the auth code captured from the redirect."""
        if auth_code_future is None:
            raise Exception("redirect_handler was not called")
        return await auth_code_future

    storage = InMemoryTokenStorage()

    # For pre-registration scenarios: pre-populate storage with the credentials
    # from MCP_CONFORMANCE_CONTEXT so the OAuthClientProvider skips DCR and uses
    # them directly. Uses client_secret_basic auth method which is what the
    # conformance test server expects.
    if client_id:
        storage._client_info = OAuthClientInformationFull(
            client_id=client_id,
            client_secret=client_secret,
            redirect_uris=[REDIRECT_URI],
            token_endpoint_auth_method="client_secret_basic",
        )

    return OAuthClientProvider(
        server_url=server_url,
        client_metadata=OAuthClientMetadata(
            client_name="mcp-use-conformance-client",
            redirect_uris=[REDIRECT_URI],
            grant_types=["authorization_code", "refresh_token"],
            response_types=["code"],
            token_endpoint_auth_method="client_secret_post",
        ),
        storage=storage,
        redirect_handler=redirect_handler,
        callback_handler=callback_handler,
        timeout=10.0,
        # For CIMD: the OAuthClientProvider checks should_use_client_metadata_url()
        # and uses this URL as client_id instead of doing DCR when the server
        # advertises client_id_metadata_document_supported=true.
        client_metadata_url=client_metadata_url,
    )


# =============================================================================
# Elicitation callback
# =============================================================================


async def handle_elicitation(_ctx, params: ElicitRequestParams) -> ElicitResult:
    """Accept elicitation requests, applying schema defaults from the server.

    The elicitation-sep1034-client-defaults scenario sends a schema with default
    values for each field. The client must return those defaults — not empty content.
    """
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
    """List tools and call each one with auto-generated arguments.

    The conformance test server exposes tools with known schemas. We generate
    placeholder arguments based on the input schema types. Some tools may
    intentionally error (e.g., test_error_handling) — we catch and ignore those.
    """
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
    """Call elicitation tools so the framework can validate default handling.

    Only calls tools with "elicit" in the name — the conformance test checks
    that our elicitation callback returns the schema defaults.
    """
    tools = await session.list_tools()
    for tool in tools:
        if "elicit" not in (tool.name or "").lower():
            continue
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
    context_str = os.environ.get("MCP_CONFORMANCE_CONTEXT", "")
    context = json.loads(context_str) if context_str else {}

    # Build config — auth scenarios pass a headless OAuthClientProvider as httpx.Auth
    server_config: dict = {"url": server_url}
    if scenario.startswith("auth/"):
        # Pre-registered credentials from MCP_CONFORMANCE_CONTEXT (auth/pre-registration)
        pre_client_id = context.get("client_id")
        pre_client_secret = context.get("client_secret")

        # CIMD URL for auth/basic-cimd — must match the conformance test's expected value
        client_metadata_url = None
        if scenario == "auth/basic-cimd":
            client_metadata_url = "https://conformance-test.local/client-metadata.json"

        server_config["auth"] = create_headless_oauth_provider(
            server_url,
            client_id=pre_client_id,
            client_secret=pre_client_secret,
            client_metadata_url=client_metadata_url,
        )

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
            # The test server exposes a test_reconnection tool that closes the SSE
            # stream. We must call it so the MCP SDK transport can demonstrate proper
            # reconnection behavior (reconnect via GET with Last-Event-ID header).
            # Ref: https://github.com/modelcontextprotocol/conformance/blob/main/src/scenarios/client/sse-retry.ts
            tools = await session.list_tools()
            for tool in tools:
                try:
                    await session.call_tool(tool.name, {})
                except Exception:
                    pass
            # Wait for the transport to reconnect after stream closure
            await asyncio.sleep(3)

        elif scenario.startswith("auth/"):
            # After authenticating, exercise the connection by calling tools.
            # This is required for auth/scope-step-up: calling tools/call triggers
            # a 403 insufficient_scope response, which httpx's OAuthClientProvider
            # handles by re-authorizing with escalated scopes automatically.
            await run_tools_call(session)

        else:
            await run_tools_call(session)

    finally:
        await client.close_all_sessions()


if __name__ == "__main__":
    asyncio.run(main())
