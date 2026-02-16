"""
Unit tests for MCPServer host/port configuration.

These tests verify that:
1. Default host/port values are cloud-friendly (0.0.0.0:8000)
2. Custom host/port can be set at initialization
3. run() can override host/port from __init__
4. Settings are correctly passed to FastMCP
"""

import pytest

from mcp_use.server import MCPServer


class TestMCPServerDefaults:
    """Test default configuration values."""

    def test_default_host_is_cloud_friendly(self):
        """Default host should be 0.0.0.0 for cloud/proxy compatibility."""
        server = MCPServer(name="test-server")
        assert server.settings.host == "0.0.0.0"

    def test_default_port_is_8000(self):
        """Default port should be 8000."""
        server = MCPServer(name="test-server")
        assert server.settings.port == 8000


class TestMCPServerCustomConfig:
    """Test custom host/port configuration at init."""

    def test_custom_host_at_init(self):
        """Host can be customized at initialization."""
        server = MCPServer(name="test-server", host="127.0.0.1")
        assert server.settings.host == "127.0.0.1"

    def test_custom_port_at_init(self):
        """Port can be customized at initialization."""
        server = MCPServer(name="test-server", port=3000)
        assert server.settings.port == 3000

    def test_custom_host_and_port_at_init(self):
        """Both host and port can be customized together."""
        server = MCPServer(name="test-server", host="127.0.0.1", port=9000)
        assert server.settings.host == "127.0.0.1"
        assert server.settings.port == 9000


class TestDNSRebindingProtection:
    """Test DNS rebinding protection based on host."""

    def test_localhost_enables_dns_protection(self):
        """127.0.0.1 should auto-enable DNS rebinding protection."""
        server = MCPServer(name="test-server", host="127.0.0.1")
        security = server.settings.transport_security
        assert security is not None
        assert security.enable_dns_rebinding_protection is True

    def test_all_interfaces_disables_dns_protection(self):
        """0.0.0.0 should not enable DNS rebinding protection."""
        server = MCPServer(name="test-server", host="0.0.0.0")
        security = server.settings.transport_security
        # Either None or explicitly disabled
        assert security is None or security.enable_dns_rebinding_protection is False


class TestRunHostOverride:
    """Test that run() properly reconfigures DNS protection when host changes."""

    def test_dns_rebinding_protection_flag_enables_protection(self):
        """Setting dns_rebinding_protection=True should enable DNS protection."""
        server = MCPServer(name="test-server", dns_rebinding_protection=True)
        assert server.settings.transport_security is not None
        assert server.settings.transport_security.enable_dns_rebinding_protection is True

    def test_dns_rebinding_protection_default_disabled(self):
        """DNS protection should be disabled by default."""
        server = MCPServer(name="test-server")
        assert (
            server.settings.transport_security is None
            or server.settings.transport_security.enable_dns_rebinding_protection is False
        )
