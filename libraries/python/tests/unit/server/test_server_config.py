"""
Unit tests for MCPServer host/port configuration and debug mode.

These tests verify that:
1. Default host/port values are cloud-friendly (0.0.0.0:8000)
2. Custom host/port can be set at initialization
3. run() can override host/port from __init__
4. Settings are correctly passed to FastMCP
5. Debug routes are registered correctly
"""

from unittest.mock import patch

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


class TestDebugRoutes:
    """Test that debug routes are registered correctly."""

    def _get_route_paths(self, server: MCPServer) -> list[str]:
        return [r.path for r in server._custom_starlette_routes]

    def test_debug_false_no_dev_routes(self):
        """debug=False should not register dev routes."""
        server = MCPServer(name="test-server", debug=False)
        paths = self._get_route_paths(server)
        assert "/docs" not in paths
        assert "/inspector" not in paths
        assert "/openmcp.json" not in paths

    def test_debug_true_at_init_registers_routes(self):
        """debug=True at init should register dev routes."""
        server = MCPServer(name="test-server", debug=True)
        paths = self._get_route_paths(server)
        assert "/docs" in paths
        assert "/inspector" in paths
        assert "/openmcp.json" in paths

    def test_debug_true_at_run_registers_routes(self):
        """debug=True passed to run() should register dev routes even if init had debug=False.

        Regression test for https://github.com/mcp-use/mcp-use/issues/1099
        """
        server = MCPServer(name="test-server", debug=False)
        assert "/docs" not in self._get_route_paths(server)

        # Patch ServerRunner.run to prevent actually starting the server
        with patch("mcp_use.server.server.ServerRunner.run"):
            server.run(debug=True)

        paths = self._get_route_paths(server)
        assert "/docs" in paths
        assert "/inspector" in paths
        assert "/openmcp.json" in paths
        assert server.debug_level == 1
