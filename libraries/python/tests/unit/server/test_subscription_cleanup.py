"""Unit tests for resource subscription cleanup on client disconnect.

Verifies the fix for GitHub issue #1092: when a client disconnects without
explicitly unsubscribing, weak references ensure the subscription entries
are automatically cleaned up by the garbage collector.
"""

import gc
import weakref

import pytest

from mcp_use.server import MCPServer


class FakeSession:
    """Minimal session-like object that supports weak references."""

    def __init__(self):
        self.notified_uris: list[str] = []

    async def send_resource_updated(self, uri: str) -> None:
        self.notified_uris.append(uri)


@pytest.mark.asyncio
async def test_subscription_cleanup_after_session_gc():
    """Subscriptions are removed when a session is garbage-collected.

    Simulates a client that subscribes to a resource and then disconnects
    abruptly (no unsubscribe). After GC, the subscription set should be empty.
    """
    server = MCPServer(name="test")
    uri = "data://test-resource"

    session = FakeSession()
    weak = weakref.ref(session)

    # Manually add subscription (simulates the subscribe handler)
    server._resource_subscriptions.setdefault(uri, weakref.WeakSet()).add(session)
    assert len(server._resource_subscriptions[uri]) == 1

    # Simulate abrupt disconnect: drop all strong references
    del session
    gc.collect()

    # Session should be dead
    assert weak() is None

    # Subscription set should now be empty
    assert len(server._resource_subscriptions.get(uri, weakref.WeakSet())) == 0


@pytest.mark.asyncio
async def test_notify_skips_gc_collected_sessions():
    """notify_resource_updated works correctly when sessions have been GC'd."""
    server = MCPServer(name="test")
    uri = "data://test-resource"

    live_session = FakeSession()
    dead_session = FakeSession()

    subs = weakref.WeakSet()
    subs.add(live_session)
    subs.add(dead_session)
    server._resource_subscriptions[uri] = subs

    # Kill one session
    del dead_session
    gc.collect()

    # Only the live session should be notified
    await server.notify_resource_updated(uri)
    assert live_session.notified_uris == [uri]


@pytest.mark.asyncio
async def test_notify_does_not_crash_when_all_sessions_gone():
    """notify_resource_updated is safe to call after all subscribers are GC'd."""
    server = MCPServer(name="test")
    uri = "data://test-resource"

    session = FakeSession()
    server._resource_subscriptions.setdefault(uri, weakref.WeakSet()).add(session)

    del session
    gc.collect()

    # Should complete without errors
    await server.notify_resource_updated(uri)

    # The empty dict entry should also be cleaned up
    assert uri not in server._resource_subscriptions


@pytest.mark.asyncio
async def test_multiple_uris_independent_cleanup():
    """Sessions subscribed to different URIs are cleaned up independently."""
    server = MCPServer(name="test")

    session_a = FakeSession()
    session_b = FakeSession()

    server._resource_subscriptions.setdefault("uri://a", weakref.WeakSet()).add(session_a)
    server._resource_subscriptions.setdefault("uri://a", weakref.WeakSet()).add(session_b)
    server._resource_subscriptions.setdefault("uri://b", weakref.WeakSet()).add(session_b)

    # Drop session_a only
    del session_a
    gc.collect()

    # uri://a should still have session_b
    assert len(server._resource_subscriptions["uri://a"]) == 1
    # uri://b is unaffected
    assert len(server._resource_subscriptions["uri://b"]) == 1

    # Notify uri://a — only session_b should receive it
    await server.notify_resource_updated("uri://a")
    assert session_b.notified_uris == ["uri://a"]
