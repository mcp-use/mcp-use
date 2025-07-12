import asyncio
import logging
import subprocess
from pathlib import Path

import pytest
from mcp.client.session import ClientSession
from mcp.types import CreateMessageRequestParams, CreateMessageResult, ErrorData, TextContent

from mcp_use.client import MCPClient

logger = logging.getLogger(__name__)


@pytest.fixture
async def streaming_server_process():
    """Start the custom streaming server process for testing"""
    server_path = Path(__file__).parent.parent / "servers_for_testing" / "primitive_server.py"

    logger.info(f"Starting custom streaming server: python {server_path}")

    # Start the server process
    process = subprocess.Popen(
        ["python", str(server_path)],
        cwd=str(server_path.parent),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    # Give the server more time to start (it's more complex)
    server_url = "http://127.0.0.1:8080"
    await asyncio.sleep(2)
    yield server_url

    # Cleanup
    logger.info("Cleaning up streaming server process")
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            logger.info("Process didn't terminate gracefully, killing it")
            process.kill()
            process.wait()

    print("Streaming server cleanup complete")


async def sampling_callback(
    context: ClientSession, params: CreateMessageRequestParams
) -> CreateMessageResult | ErrorData:
    return CreateMessageResult(
        content=TextContent(text="Hello, world!", type="text"), model="gpt-4o-mini", role="assistant"
    )


@pytest.mark.asyncio
async def test_sampling(streaming_server_process):
    config = {"mcpServers": {"PrimitiveServer": {"url": f"{streaming_server_process}/mcp"}}}
    client = MCPClient(config, sampling_callback=sampling_callback)
    try:
        await client.create_all_sessions()
        session = client.get_session("PrimitiveServer")
        result = await session.connector.call_tool(name="analyze_sentiment", arguments={"text": "Hello, world!"})
        content = result.content[0]
        logger.info(f"Result: {content}")
        assert content.text == "Hello, world!"
    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_sampling_with_no_callback(streaming_server_process):
    try:
        config = {"mcpServers": {"PrimitiveServer": {"url": f"{streaming_server_process}/mcp"}}}
        client = MCPClient(config)
        await client.create_all_sessions()
        session = client.get_session("PrimitiveServer")
        result = await session.connector.call_tool(name="analyze_sentiment", arguments={"text": "Hello, world!"})
        logger.info(f"Result: {result}")
        print(f"Result: {result}")
        assert result.isError
    finally:
        await client.close_all_sessions()
