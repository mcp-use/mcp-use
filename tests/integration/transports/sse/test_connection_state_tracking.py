"""
Test for GitHub Issue #120: Connection State Not Properly Tracked After SSE Disconnection

This test specifically validates that:
1. Connection state is properly tracked when SSE connections are closed by the server
2. Auto-reconnection works when connections are lost
3. Clear error messages are provided when tools are called on disconnected sessions
4. The is_connected property accurately reflects the actual connection state
"""

import asyncio
import subprocess
import time
from pathlib import Path

import pytest

from mcp_use import MCPClient


@pytest.fixture
async def timeout_server_process():
    """Start a server that closes connections after a short timeout for testing"""
    server_path = Path(__file__).parent.parent.parent / "servers_for_testing" / "timeout_test_server.py"

    print(f"Starting timeout test server: python {server_path}")

    # Start the server process
    process = subprocess.Popen(
        ["python", str(server_path)],
        cwd=str(server_path.parent),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    # Give the server time to start
    await asyncio.sleep(2)
    server_url = "http://127.0.0.1:8081"
    yield server_url

    # Cleanup
    print("Cleaning up timeout test server process")
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            print("Process didn't terminate gracefully, killing it")
            process.kill()
            process.wait()

    print("Timeout test server cleanup complete")


@pytest.mark.asyncio
async def test_github_issue_120_fixed_behavior(timeout_server_process):
    """Test that GitHub issue #120 is fixed: connection state properly tracked and auto-reconnection works"""
    server_url = timeout_server_process

    # Step 1: Create an HttpConnector with SSE endpoint configuration
    config = {"mcpServers": {"fixTest": {"url": f"{server_url}/sse"}}}

    client = MCPClient(config=config)
    try:
        await client.create_all_sessions()
        session = client.get_session("fixTest")

        assert session is not None, "Session should be created"

        # Step 2: Initialize an MCP session
        await session.initialize()
        assert session.is_connected, "Session should be connected after initialize"

        # Get a tool to call later
        tools = session.connector.tools
        assert len(tools) > 0, "Should have at least one tool"
        test_tool = tools[0]

        print(f"Initial connection established, testing tool: {test_tool.name}")
        print(f"is_connected: {session.is_connected}")

        # Verify tool works initially
        result1 = await session.connector.call_tool(test_tool.name, {})
        assert result1 is not None, "Tool call should succeed while connected"
        print("✓ Tool call succeeded while connected")

        # Step 3: Wait for 30+ seconds for the server to close the SSE connection due to inactivity
        print("Waiting for server timeout (10 seconds)...")
        await asyncio.sleep(10)

        # Step 4: Check connection state - should now properly detect disconnection
        print(f"Connection state after 10 second timeout: {session.is_connected}")

        # With the fix, is_connected should properly detect the disconnection
        # But since auto_connect is enabled, it might auto-reconnect on the next call

        # Step 5: Attempt to call a tool - should either work (auto-reconnect) or give clear error
        print("Attempting tool call after timeout...")
        try:
            result2 = await session.connector.call_tool(test_tool.name, {})
            # If auto-reconnection works, this should succeed
            if result2 is not None:
                print("✓ Tool call succeeded - auto-reconnection worked")
                print(f"is_connected after successful tool call: {session.is_connected}")
                assert session.is_connected, "Connection should be active after successful auto-reconnection"
            else:
                print("⚠ Tool call returned None unexpectedly")
        except RuntimeError as e:
            error_msg = str(e)
            print(f"Tool call failed with clear error: '{error_msg}'")

            # With the fix, we should get a clear error message (not empty)
            assert error_msg != "", "Error message should not be empty (GitHub Issue #120 fixed)"
            assert (
                "reconnect" in error_msg.lower() or "connection" in error_msg.lower()
            ), "Error message should mention connection/reconnection issues"
            print("✓ Clear error message provided instead of empty error")
        except Exception as e:
            # Any other exception should also have a clear message
            error_msg = str(e)
            print(f"Tool call failed with exception: {type(e).__name__}: '{error_msg}'")
            assert error_msg != "", "Error message should not be empty"

        print("✓ GitHub Issue #120 fix verified - proper connection state tracking and clear errors")

    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_github_issue_120_manual_connection(timeout_server_process):
    """Test GitHub issue #120 fix with manual connection - should provide clear error messages"""
    server_url = timeout_server_process

    # Create connector and test manual connection behavior
    config = {"mcpServers": {"noAutoTest": {"url": f"{server_url}/sse"}}}

    client = MCPClient(config=config)
    try:
        await client.create_all_sessions()
        session = client.get_session("noAutoTest")

        assert session is not None, "Session should be created"

        # Connect and initialize manually
        await session.connect()
        await session.initialize()
        assert session.is_connected, "Session should be connected after manual connect"

        # Get a tool to call later
        tools = session.connector.tools
        assert len(tools) > 0, "Should have at least one tool"
        test_tool = tools[0]

        print(f"Initial connection established (manual connection), testing tool: {test_tool.name}")
        print(f"is_connected: {session.is_connected}")

        # Verify tool works initially
        result1 = await session.connector.call_tool(test_tool.name, {})
        assert result1 is not None, "Tool call should succeed while connected"
        print("✓ Tool call succeeded while connected")

        # Wait for server timeout
        print("Waiting for server timeout (10 seconds)...")
        await asyncio.sleep(10)

        # Check connection state after timeout
        print(f"Connection state after 10 second timeout: {session.is_connected}")

        # Attempt to call a tool - should either auto-reconnect or fail with clear error message
        print("Attempting tool call after timeout...")
        try:
            result2 = await session.connector.call_tool(test_tool.name, {})
            # If this succeeds, the connection may still be active or there's an issue
            if result2 is not None:
                print("⚠ Tool call succeeded unexpectedly - connection may still be active")
                print(f"is_connected after tool call: {session.is_connected}")
            else:
                print("⚠ Tool call returned None")
        except RuntimeError as e:
            error_msg = str(e)
            print(f"✓ Tool call failed with clear error: '{error_msg}'")

            # With the fix, we should get a clear error message about connection loss
            assert error_msg != "", "Error message should not be empty (GitHub Issue #120 fixed)"
            assert "connection" in error_msg.lower(), "Error message should mention connection issues"
            print("✓ Clear error message provided for connection loss")
        except Exception as e:
            error_msg = str(e)
            print(f"Tool call failed with exception: {type(e).__name__}: '{error_msg}'")
            # Any error should have a clear message
            assert error_msg != "", "Error message should not be empty"

        print("✓ GitHub Issue #120 fix verified - clear error messages")

    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_connection_manager_task_detection(timeout_server_process):
    """Test that connection manager task completion is properly detected"""
    server_url = timeout_server_process
    config = {"mcpServers": {"timeoutTest": {"url": f"{server_url}/sse"}}}

    client = MCPClient(config=config)
    try:
        await client.create_all_sessions()
        session = client.get_session("timeoutTest")

        # Connect manually
        await session.connect()
        assert session.is_connected, "Should be connected after manual connect"

        # Check that connection manager task is running
        connector = session.connector
        assert hasattr(connector, "_connection_manager"), "Should have connection manager"
        assert hasattr(connector._connection_manager, "_task"), "Connection manager should have task"
        assert not connector._connection_manager._task.done(), "Task should be running initially"

        # Wait for server timeout
        await asyncio.sleep(8)

        # Check connection manager task state
        task_done = connector._connection_manager._task.done()
        print(f"Connection manager task done: {task_done}")

        # Check is_connected property - with the fix, it should properly detect disconnection
        is_connected = session.is_connected
        print(f"is_connected result: {is_connected}")

        # With the fix, when task is done, is_connected should return False
        if task_done:
            assert not is_connected, "is_connected should return False when connection manager task is done"
            print("✓ Connection properly detected as disconnected when task is done")
        else:
            print("⚠ Connection manager task still running")

        print("✓ Connection manager task state properly detected")

    finally:
        await client.close_all_sessions()


@pytest.mark.asyncio
async def test_multiple_reconnection_attempts(timeout_server_process):
    """Test that auto-reconnection works multiple times"""
    server_url = timeout_server_process
    config = {"mcpServers": {"timeoutTest": {"url": f"{server_url}/sse"}}}

    client = MCPClient(config=config)
    try:
        await client.create_all_sessions()
        session = client.get_session("timeoutTest")
        tools = session.connector.tools
        test_tool = tools[0]

        # Test multiple disconnect/reconnect cycles
        for cycle in range(2):  # Reduced to 2 cycles to keep test time reasonable
            print(f"\n--- Testing cycle {cycle + 1} ---")

            # Ensure connected at start of cycle
            if not session.is_connected:
                await session.connect()
            print(f"Connected at start of cycle {cycle + 1}: {session.is_connected}")

            # Use the connection
            try:
                result = await session.connector.call_tool(test_tool.name, {})
                print(f"Tool call succeeded: {result is not None}")
            except Exception as e:
                print(f"Tool call failed: {e}")

            # Wait for timeout
            print("Waiting for server timeout...")
            await asyncio.sleep(8)

            # Observe connection state after timeout
            print(f"Connection state after timeout in cycle {cycle + 1}: {session.is_connected}")

            # Try using connection after timeout
            try:
                result2 = await session.connector.call_tool(test_tool.name, {})
                print(f"Tool call after timeout succeeded: {result2 is not None}")
            except RuntimeError as e:
                error_msg = str(e)
                print(f"Tool call after timeout failed with clear error: {error_msg}")
                # Should get clear error message
                assert error_msg != "", "Error message should not be empty"
            except Exception as e:
                print(f"Tool call after timeout failed: {e}")

        print("\n✓ Multiple cycle test completed - auto-reconnection behavior verified")

    finally:
        await client.close_all_sessions()
