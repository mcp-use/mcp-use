"""
Unit tests for WebSocketConnector.

Covers:
- super().__init__() is called so BaseConnector attributes are present
- _send_request cleans up pending_requests on CancelledError (BaseException)
- _send_request cleans up pending_requests on generic Exception
- _send_request leaves no dangling future on success
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_use.client.connectors.websocket import WebSocketConnector
from mcp_use.client.middleware import MiddlewareManager


class TestWebSocketConnectorInit:
    """WebSocketConnector must initialise all BaseConnector attributes via super().__init__()."""

    def test_base_attributes_present(self):
        """All attributes set by BaseConnector.__init__ must exist after construction."""
        connector = WebSocketConnector("ws://localhost:9000")

        # These live on BaseConnector; they used to be missing because super().__init__()
        # was never called.
        assert hasattr(connector, "client_session")
        assert connector.client_session is None

        assert hasattr(connector, "_resources")
        assert connector._resources is None

        assert hasattr(connector, "_prompts")
        assert connector._prompts is None

        assert hasattr(connector, "_initialized")
        assert connector._initialized is False

        assert hasattr(connector, "auto_reconnect")
        assert connector.auto_reconnect is True

        assert hasattr(connector, "capabilities")
        assert connector.capabilities is None

        assert hasattr(connector, "_record_telemetry")

        assert hasattr(connector, "_roots")
        assert connector._roots == []

        assert hasattr(connector, "middleware_manager")
        assert isinstance(connector.middleware_manager, MiddlewareManager)

    def test_own_attributes_still_present(self):
        """WebSocketConnector's own attributes must survive the super().__init__() call."""
        connector = WebSocketConnector("ws://example.com", headers={"X-Foo": "bar"})

        assert connector.url == "ws://example.com"
        assert connector.headers["X-Foo"] == "bar"
        assert connector.ws is None
        assert connector._receiver_task is None
        assert connector.pending_requests == {}
        assert connector._connected is False

    def test_bearer_auth_added_to_headers(self):
        connector = WebSocketConnector("ws://example.com", auth="mytoken")
        assert connector.headers.get("Authorization") == "Bearer mytoken"

    def test_non_string_auth_warns(self):
        """Non-string auth should emit a warning, not crash."""
        import httpx

        with patch("mcp_use.client.connectors.websocket.logger") as mock_log:
            WebSocketConnector("ws://example.com", auth=httpx.BasicAuth("u", "p"))
            mock_log.warning.assert_called_once()

    def test_is_connected_does_not_raise(self):
        """is_connected must be callable without AttributeError (regression test)."""
        connector = WebSocketConnector("ws://localhost:9000")
        # Before fix this raised AttributeError because client_session was not set.
        result = connector.is_connected
        assert result is False

    def test_optional_callbacks_forwarded(self):
        """Callbacks passed to __init__ must be stored on the connector."""
        sampling_cb = MagicMock()
        elicitation_cb = MagicMock()
        connector = WebSocketConnector(
            "ws://localhost:9000",
            sampling_callback=sampling_cb,
            elicitation_callback=elicitation_cb,
        )
        assert connector.sampling_callback is sampling_cb
        assert connector.elicitation_callback is elicitation_cb

    def test_roots_forwarded(self):
        from mcp.types import Root

        roots = [Root(uri="file:///tmp", name="tmp")]
        connector = WebSocketConnector("ws://localhost:9000", roots=roots)
        assert connector._roots == roots


class TestSendRequestCleanup:
    """_send_request must always remove the future from pending_requests."""

    @pytest.mark.asyncio
    async def test_success_removes_future(self):
        """On a successful response the entry must be gone from pending_requests."""
        connector = WebSocketConnector("ws://localhost:9000")
        connector._connected = True

        mock_ws = AsyncMock()
        connector.ws = mock_ws

        async def resolve_immediately(*_args, **_kwargs):
            # Mimic the receiver task resolving the first pending future.
            for fut in list(connector.pending_requests.values()):
                if not fut.done():
                    fut.set_result({"tools": []})
                    break

        mock_ws.send.side_effect = resolve_immediately

        result = await connector._send_request("tools/list")

        assert result == {"tools": []}
        assert connector.pending_requests == {}

    @pytest.mark.asyncio
    async def test_exception_removes_future(self):
        """On a generic Exception the entry must be cleaned up and exception re-raised."""
        connector = WebSocketConnector("ws://localhost:9000")
        connector._connected = True

        mock_ws = AsyncMock()
        connector.ws = mock_ws

        async def fail_send(*_args, **_kwargs):
            raise ConnectionError("send failed")

        mock_ws.send.side_effect = fail_send

        with pytest.raises(ConnectionError, match="send failed"):
            await connector._send_request("tools/list")

        assert connector.pending_requests == {}

    @pytest.mark.asyncio
    async def test_cancellation_removes_future(self):
        """CancelledError (BaseException, not Exception) must still clean up the future."""
        connector = WebSocketConnector("ws://localhost:9000")
        connector._connected = True

        mock_ws = AsyncMock()
        connector.ws = mock_ws

        async def hang_forever(*_args, **_kwargs):
            # send() succeeds but the future is never resolved, so we wait forever.
            pass

        mock_ws.send.side_effect = hang_forever

        async def run():
            await connector._send_request("tools/list")

        task = asyncio.create_task(run())
        # Let the task reach the `await future` point.
        await asyncio.sleep(0)
        task.cancel()

        with pytest.raises(asyncio.CancelledError):
            await task

        # Before the fix, the future lingered here indefinitely.
        assert connector.pending_requests == {}

    @pytest.mark.asyncio
    async def test_cancelled_future_is_cancelled(self):
        """The asyncio.Future itself must be cancelled so the receiver won't resolve it."""
        connector = WebSocketConnector("ws://localhost:9000")
        connector._connected = True

        mock_ws = AsyncMock()
        connector.ws = mock_ws
        mock_ws.send.side_effect = AsyncMock()

        # Capture the future before cancellation.
        captured: list[asyncio.Future] = []

        original_send = mock_ws.send.side_effect

        async def capture_and_send(*args, **kwargs):
            captured.extend(connector.pending_requests.values())

        mock_ws.send.side_effect = capture_and_send

        task = asyncio.create_task(connector._send_request("tools/list"))
        await asyncio.sleep(0)
        task.cancel()

        with pytest.raises(asyncio.CancelledError):
            await task

        assert len(captured) == 1
        assert captured[0].cancelled()

    @pytest.mark.asyncio
    async def test_no_ws_raises_immediately(self):
        """If WebSocket is not connected, RuntimeError must be raised before any send."""
        connector = WebSocketConnector("ws://localhost:9000")
        connector.ws = None

        with pytest.raises(RuntimeError, match="WebSocket is not connected"):
            await connector._send_request("tools/list")

        assert connector.pending_requests == {}
