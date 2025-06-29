"""
Timeout Test Server for GitHub Issue #120

This server specifically tests the connection state tracking issue by:
1. Accepting SSE connections
2. Closing them after a short timeout (5 seconds) to simulate server-side timeouts
3. Providing basic MCP tools to test functionality
"""

import asyncio
import json
import time
from datetime import datetime
from typing import Any

from fastmcp import FastMCP

# Create FastMCP server instance
mcp = FastMCP(name="TimeoutTestServer")

# Track connection times for timeout logic
connection_times: dict[str, float] = {}


@mcp.tool()
def ping() -> dict[str, Any]:
    """Simple ping tool for testing connectivity"""
    return {"message": "pong", "timestamp": datetime.now().isoformat(), "server": "TimeoutTestServer"}


@mcp.tool()
def get_server_info() -> dict[str, Any]:
    """Get server information"""
    return {
        "name": "TimeoutTestServer",
        "purpose": "Testing connection timeouts for issue #120",
        "timeout_seconds": 5,
        "timestamp": datetime.now().isoformat(),
    }


@mcp.tool()
def echo(message: str) -> dict[str, Any]:
    """Echo a message back"""
    return {"original_message": message, "echo": f"Server received: {message}", "timestamp": datetime.now().isoformat()}


@mcp.resource("test://server/status")
def server_status_resource() -> str:
    """Server status as a resource"""
    status = {"status": "running", "active_connections": len(connection_times), "timestamp": datetime.now().isoformat()}
    return json.dumps(status, indent=2)


@mcp.prompt()
def test_prompt() -> str:
    """A simple test prompt"""
    return f"""This is a test prompt from TimeoutTestServer.

Current time: {datetime.now().isoformat()}
Server purpose: Testing connection timeouts for GitHub issue #120

Please use this server to test:
1. Connection establishment
2. Tool calls while connected
3. Connection state after server timeout
4. Auto-reconnection behavior
"""


# Custom SSE endpoint with timeout logic
@mcp.custom_route("/sse", methods=["GET"])
async def custom_sse_endpoint(request):
    """Custom SSE endpoint that closes connections after timeout"""
    import uuid

    from fastapi.responses import StreamingResponse

    # Generate unique connection ID
    connection_id = str(uuid.uuid4())
    connection_times[connection_id] = time.time()

    print(f"New SSE connection: {connection_id}")

    async def event_generator():
        try:
            # Send initial connection event
            yield f"data: {json.dumps({'type': 'connection', 'id': connection_id, 'status': 'connected'})}\n\n"

            start_time = time.time()
            timeout_seconds = 5  # Close connection after 5 seconds

            while True:
                current_time = time.time()

                # Check if we should timeout
                if current_time - start_time > timeout_seconds:
                    print(f"Timing out connection {connection_id} after {timeout_seconds} seconds")
                    # Send timeout event before closing
                    timeout_event = {
                        "type": "timeout",
                        "id": connection_id,
                        "message": "Connection timed out",
                    }
                    yield f"data: {json.dumps(timeout_event)}\n\n"
                    break

                # Send periodic heartbeat
                yield f"data: {json.dumps({'type': 'heartbeat', 'timestamp': datetime.now().isoformat()})}\n\n"

                await asyncio.sleep(1)

        except Exception as e:
            print(f"Error in SSE connection {connection_id}: {e}")
        finally:
            # Clean up connection tracking
            if connection_id in connection_times:
                del connection_times[connection_id]
            print(f"Connection {connection_id} closed")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*"},
    )


@mcp.custom_route("/health", methods=["GET"])
async def health_check(request) -> dict:
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.now().isoformat(), "active_connections": len(connection_times)}


if __name__ == "__main__":
    print("🚀 Starting Timeout Test Server for GitHub Issue #120...")
    print("⏰ Connection timeout: 5 seconds")
    print("📡 Server features:")
    print("   - Automatic connection timeout after 5 seconds")
    print("   - Basic MCP tools for testing")
    print("   - Connection state tracking")
    print("\n💡 Available endpoints:")
    print("   - SSE endpoint: http://localhost:8081/sse")
    print("   - Health check: http://localhost:8081/health")
    print("\n💡 This server is designed to test:")
    print("   - Connection state tracking after timeout")
    print("   - Auto-reconnection behavior")
    print("   - Error handling for disconnected sessions")
    print("⚡ Starting server on port 8081...")

    # Run the FastMCP server with SSE transport
    mcp.run(transport="sse", host="0.0.0.0", port=8081, log_level="info")
