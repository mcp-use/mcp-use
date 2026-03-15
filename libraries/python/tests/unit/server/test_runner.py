"""Tests for server runner port-finding utilities."""

import socket

import pytest

from mcp_use.server.runner import _find_available_port, _is_port_available


def test_is_port_available_returns_true_for_free_port():
    """Test that _is_port_available returns True for an unbound port."""
    # Use port 0 to get an ephemeral port, then check a nearby one
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        _, bound_port = s.getsockname()
    # After closing, the port should be available
    assert _is_port_available("127.0.0.1", bound_port) is True


def test_is_port_available_returns_false_for_bound_port():
    """Test that _is_port_available returns False when a port is in use."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        _, bound_port = s.getsockname()
        # Port is still bound, should not be available
        assert _is_port_available("127.0.0.1", bound_port) is False


def test_find_available_port_returns_same_port_if_free():
    """Test that _find_available_port returns the requested port when it is free."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        _, free_port = s.getsockname()
    # Port is now free
    assert _find_available_port("127.0.0.1", free_port) == free_port


def test_find_available_port_skips_to_next_when_in_use():
    """Test that _find_available_port returns port+1 when the first port is occupied."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        _, bound_port = s.getsockname()
        # While port is bound, find_available_port should skip it
        result = _find_available_port("127.0.0.1", bound_port)
        assert result == bound_port + 1


def test_find_available_port_raises_when_all_exhausted():
    """Test that _find_available_port raises RuntimeError when no port is available."""
    sockets = []
    try:
        # Bind a contiguous range of ports
        base_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        base_sock.bind(("127.0.0.1", 0))
        _, base_port = base_sock.getsockname()
        sockets.append(base_sock)

        max_retries = 3
        # Bind the next ports in the range
        for i in range(1, max_retries):
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                s.bind(("127.0.0.1", base_port + i))
                sockets.append(s)
            except OSError:
                # If we can't bind a contiguous range, skip this test
                for sock in sockets:
                    sock.close()
                pytest.skip("Could not bind contiguous port range for test")

        with pytest.raises(RuntimeError, match="No available port found"):
            _find_available_port("127.0.0.1", base_port, max_retries=max_retries)
    finally:
        for s in sockets:
            s.close()
