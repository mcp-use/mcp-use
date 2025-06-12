"""
Long Timeout Test Server for GitHub Issue #120

This server specifically tests the connection state tracking issue by:
1. Accepting SSE connections
2. Closing them after 30+ seconds to simulate real server-side timeouts
3. Providing basic MCP tools to test functionality
4. Matching the exact reproduction steps from the GitHub issue
"""

import asyncio
import json
import time
from datetime import datetime
from typing import Any

from fastmcp import FastMCP

# Create FastMCP server instance
mcp = FastMCP(name="LongTimeoutTestServer")

# Track connection times for timeout logic
connection_times: dict[str, float] = {}


@mcp.tool()
def ping() -> dict[str, Any]:
    """Simple ping tool for testing connectivity"""
    return {"message": "pong", "timestamp": datetime.now().isoformat(), "server": "LongTimeoutTestServer"}


@mcp.tool()
def get_server_info() -> dict[str, Any]:
    """Get server information"""
    return {"name": "LongTimeoutTestServer", "purpose": "Testing connection timeouts for issue #120 with 30+ seconds", "timeout_seconds": 30, "timestamp": datetime.now().isoformat()}


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
    return f"""This is a test prompt from LongTimeoutTestServer.

Current time: {datetime.now().isoformat()}
Server purpose: Testing connection timeouts for GitHub issue #120 with 30+ second timeout

Please use this server to test:
1. Connection establishment
2. Tool calls while connected
3. Connection state after 30+ second server timeout
4. Auto-reconnection behavior after long timeouts
"""


# Custom SSE endpoint with 30+ second timeout logic
@mcp.custom_route("/sse", methods=["GET"])
async def custom_sse_endpoint(request):
    """Custom SSE endpoint that closes connections after 30+ seconds to match issue #120"""
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
            timeout_seconds = 30  # Close connection after 30 seconds to match issue reproduction

            heartbeat_count = 0
            while True:
                current_time = time.time()

                # Check if we should timeout
                if current_time - start_time > timeout_seconds:
                    print(f"Timing out connection {connection_id} after {timeout_seconds} seconds")
                    # Send timeout event before closing
                    yield f"data: {json.dumps({'type': 'timeout', 'id': connection_id, 'message': 'Connection timed out after 30 seconds'})}\n\n"
                    break

                # Send periodic heartbeat every 5 seconds
                if heartbeat_count % 5 == 0:
                    yield f"data: {json.dumps({'type': 'heartbeat', 'timestamp': datetime.now().isoformat(), 'elapsed': int(current_time - start_time)})}\n\n"

                await asyncio.sleep(1)
                heartbeat_count += 1

        except Exception as e:
            print(f"Error in SSE connection {connection_id}: {e}")
            # This should simulate the "peer closed connection without sending complete message body" error
        finally:
            # Clean up connection tracking
            if connection_id in connection_times:
                del connection_times[connection_id]
            print(f"Connection {connection_id} closed - this should trigger the disconnection logs mentioned in issue #120")

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*"})


@mcp.custom_route("/health", methods=["GET"])
async def health_check(request) -> dict:
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.now().isoformat(), "active_connections": len(connection_times), "timeout_seconds": 30}


if __name__ == "__main__":
    print("🚀 Starting Long Timeout Test Server for GitHub Issue #120...")
    print("⏰ Connection timeout: 30 seconds (matches issue reproduction steps)")
    print("📡 Server features:")
    print("   - Automatic connection timeout after 30 seconds")
    print("   - Basic MCP tools for testing")
    print("   - Connection state tracking")
    print("   - Simulates 'peer closed connection' errors")
    print("\n💡 Available endpoints:")
    print("   - SSE endpoint: http://localhost:8082/sse")
    print("   - Health check: http://localhost:8082/health")
    print("\n💡 This server is designed to test:")
    print("   - Connection state tracking after 30+ second timeout")
    print("   - Auto-reconnection behavior after long timeouts")
    print("   - Error handling for disconnected sessions with empty error messages")
    print("   - Exact reproduction of GitHub Issue #120 steps")
    print("⚡ Starting server on port 8082...")

    # Run the FastMCP server with SSE transport
    mcp.run(transport="sse", host="0.0.0.0", port=8082, log_level="info")
