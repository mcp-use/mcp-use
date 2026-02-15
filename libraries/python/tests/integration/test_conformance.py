"""
MCP Conformance Integration Tests

Tests the mcp-use Python SDK against the official MCP conformance test suite.
Starts the conformance server, then validates both server-side protocol compliance
(via the external conformance runner) and client-side behavior (via MCPClient).
"""

import asyncio
import subprocess
import sys
from pathlib import Path

import pytest
from mcp.client.session import RequestContext
from mcp.types import ElicitRequestParams, ElicitResult

from mcp_use.client import MCPClient

CONFORMANCE_SERVER_PATH = Path(__file__).parent / "servers_for_testing" / "conformance_server.py"
CONFORMANCE_CLIENT_PATH = Path(__file__).parent / "clients_for_testing" / "conformance_client.py"
SERVER_PORT = 8765  # Use a non-default port to avoid conflicts


@pytest.fixture(scope="module")
async def conformance_server():
    """Start the conformance server as a subprocess."""
    process = subprocess.Popen(
        [
            sys.executable,
            str(CONFORMANCE_SERVER_PATH),
            "--transport",
            "streamable-http",
            "--port",
            str(SERVER_PORT),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env={**__import__("os").environ, "MCP_USE_ANONYMIZED_TELEMETRY": "false"},
    )

    await asyncio.sleep(3)

    yield f"http://127.0.0.1:{SERVER_PORT}"

    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


# =============================================================================
# Server conformance (external runner)
# =============================================================================


@pytest.mark.asyncio
async def test_server_conformance_via_runner(conformance_server):
    """Run the official MCP conformance test suite against our server.

    This executes `npx @modelcontextprotocol/conformance server` and asserts
    zero failures across all active scenarios.
    """
    result = subprocess.run(
        [
            "npx",
            "@modelcontextprotocol/conformance",
            "server",
            "--url",
            f"{conformance_server}/mcp",
        ],
        capture_output=True,
        text=True,
        timeout=180,
    )

    # Parse the summary line: "Total: X passed, Y failed"
    for line in result.stdout.splitlines():
        if line.startswith("Total:"):
            parts = line.split(",")
            failed = int(parts[1].strip().split()[0])
            assert failed == 0, f"Server conformance failures:\n{result.stdout}"
            return

    # If we didn't find the Total line, the runner may have crashed
    pytest.fail(f"Could not parse conformance output:\nstdout: {result.stdout}\nstderr: {result.stderr}")


@pytest.mark.asyncio
async def test_client_conformance_via_runner():
    """Run the official MCP conformance client tests against our MCPClient.

    Tests core (non-auth) client scenarios: initialize, tools_call,
    elicitation defaults, and SSE retry.
    """
    scenarios = ["initialize", "tools_call", "elicitation-sep1034-client-defaults", "sse-retry"]
    failures = []

    for scenario in scenarios:
        result = subprocess.run(
            [
                "npx",
                "@modelcontextprotocol/conformance",
                "client",
                "--command",
                f"{sys.executable} {CONFORMANCE_CLIENT_PATH}",
                "--scenario",
                scenario,
                "--timeout",
                "30000",
            ],
            capture_output=True,
            text=True,
            timeout=60,
            env={**__import__("os").environ, "MCP_USE_ANONYMIZED_TELEMETRY": "false"},
        )

        if "FAILED" in result.stdout:
            failures.append(f"{scenario}: {result.stdout}")

    assert not failures, f"Client conformance failures:\n{''.join(failures)}"


# =============================================================================
# Client-side conformance (direct MCPClient tests against conformance server)
# =============================================================================


@pytest.mark.asyncio
async def test_client_initialize(conformance_server):
    """Client connects and initializes successfully."""
    config = {"mcpServers": {"test": {"url": f"{conformance_server}/mcp"}}}
    client = MCPClient(config=config)
    try:
        await client.create_all_sessions()
        session = client.get_session("test")
        assert session is not None
        assert session.is_connected
    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_client_list_tools(conformance_server):
    """Client lists all tools from the conformance server."""
    config = {"mcpServers": {"test": {"url": f"{conformance_server}/mcp"}}}
    client = MCPClient(config=config)
    try:
        await client.create_all_sessions()
        session = client.get_session("test")
        tools = await session.list_tools()
        tool_names = {t.name for t in tools}

        expected = {
            "test_simple_text",
            "test_image_content",
            "test_audio_content",
            "test_embedded_resource",
            "test_multiple_content_types",
            "test_tool_with_logging",
            "test_tool_with_progress",
            "test_sampling",
            "test_elicitation",
            "test_elicitation_sep1034_defaults",
            "test_elicitation_sep1330_enums",
            "test_error_handling",
            "update_subscribable_resource",
        }
        assert expected.issubset(tool_names), f"Missing tools: {expected - tool_names}"
    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_client_call_simple_text_tool(conformance_server):
    """Client calls a simple text tool and gets the correct response."""
    config = {"mcpServers": {"test": {"url": f"{conformance_server}/mcp"}}}
    client = MCPClient(config=config)
    try:
        await client.create_all_sessions()
        session = client.get_session("test")
        result = await session.call_tool("test_simple_text", {"message": "conformance"})
        assert result.content[0].text == "Echo: conformance"
    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_client_list_resources(conformance_server):
    """Client lists all resources from the conformance server."""
    config = {"mcpServers": {"test": {"url": f"{conformance_server}/mcp"}}}
    client = MCPClient(config=config)
    try:
        await client.create_all_sessions()
        session = client.get_session("test")
        resources = await session.list_resources()
        resource_names = {r.name for r in resources}
        assert "static_text" in resource_names
        assert "static_binary" in resource_names
        assert "subscribable_resource" in resource_names
    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_client_read_text_resource(conformance_server):
    """Client reads a text resource."""
    config = {"mcpServers": {"test": {"url": f"{conformance_server}/mcp"}}}
    client = MCPClient(config=config)
    try:
        await client.create_all_sessions()
        session = client.get_session("test")
        result = await session.read_resource("test://static-text")
        assert result.contents[0].text == "This is static text content"
    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_client_list_prompts(conformance_server):
    """Client lists all prompts from the conformance server."""
    config = {"mcpServers": {"test": {"url": f"{conformance_server}/mcp"}}}
    client = MCPClient(config=config)
    try:
        await client.create_all_sessions()
        session = client.get_session("test")
        prompts = await session.list_prompts()
        prompt_names = {p.name for p in prompts}
        assert "test_simple_prompt" in prompt_names
        assert "test_prompt_with_arguments" in prompt_names
    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_client_get_prompt(conformance_server):
    """Client gets a prompt with arguments."""
    config = {"mcpServers": {"test": {"url": f"{conformance_server}/mcp"}}}
    client = MCPClient(config=config)
    try:
        await client.create_all_sessions()
        session = client.get_session("test")
        result = await session.get_prompt("test_prompt_with_arguments", arguments={"arg1": "hello", "arg2": "world"})
        assert len(result.messages) > 0
        assert "hello" in result.messages[0].content.text
        assert "world" in result.messages[0].content.text
    finally:
        await client.close_all_sessions()


async def _accept_elicitation(ctx: RequestContext, params: ElicitRequestParams) -> ElicitResult:
    """Elicitation callback that applies schema defaults."""
    content = {}
    if hasattr(params, "requestedSchema") and params.requestedSchema:
        schema = params.requestedSchema
        properties = schema.get("properties", {}) if isinstance(schema, dict) else {}
        for name, field_schema in properties.items():
            if isinstance(field_schema, dict) and "default" in field_schema:
                content[name] = field_schema["default"]
    return ElicitResult(action="accept", content=content)


@pytest.mark.asyncio
async def test_client_elicitation(conformance_server):
    """Client handles elicitation requests from the server."""
    config = {"mcpServers": {"test": {"url": f"{conformance_server}/mcp"}}}
    client = MCPClient(config=config, elicitation_callback=_accept_elicitation)
    try:
        await client.create_all_sessions()
        session = client.get_session("test")
        result = await session.call_tool("test_elicitation", {})
        assert "Received:" in result.content[0].text
        assert "Anonymous" in result.content[0].text
    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_client_error_handling(conformance_server):
    """Client handles tool errors gracefully."""
    config = {"mcpServers": {"test": {"url": f"{conformance_server}/mcp"}}}
    client = MCPClient(config=config)
    try:
        await client.create_all_sessions()
        session = client.get_session("test")
        result = await session.call_tool("test_error_handling", {})
        assert result.isError is True
    finally:
        await client.close_all_sessions()
