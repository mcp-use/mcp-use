"""Tests for the clean public API exports (issue #953).

Validates that the documented 2.0 import patterns work correctly,
that the Connector factory auto-infers the right type, and that
no circular imports are introduced.
"""

import pytest

# ---------------------------------------------------------------------------
# 1. Top-level imports
# ---------------------------------------------------------------------------


class TestTopLevelImports:
    """Ensure all public names are importable from ``mcp_use``."""

    def test_mcp_client(self):
        from mcp_use import MCPClient

        assert MCPClient is not None

    def test_stdio_connector(self):
        from mcp_use import StdioConnector

        assert StdioConnector is not None

    def test_http_connector(self):
        from mcp_use import HttpConnector

        assert HttpConnector is not None

    def test_connector_factory(self):
        from mcp_use import Connector

        assert callable(Connector)

    def test_mcp_server(self):
        from mcp_use import MCPServer

        assert MCPServer is not None


# ---------------------------------------------------------------------------
# 2. Connector factory auto-inference
# ---------------------------------------------------------------------------


class TestConnectorFactory:
    """Ensure ``Connector(...)`` infers the correct connector type."""

    def test_infers_http_connector(self):
        from mcp_use import Connector
        from mcp_use.client.connectors.http import HttpConnector

        conn = Connector(url="https://api.example.com/mcp")
        assert isinstance(conn, HttpConnector)

    def test_infers_stdio_connector(self):
        from mcp_use import Connector
        from mcp_use.client.connectors.stdio import StdioConnector

        conn = Connector(command="npx", args=["@playwright/mcp"])
        assert isinstance(conn, StdioConnector)

    def test_raises_on_no_args(self):
        from mcp_use import Connector

        with pytest.raises(ValueError, match="Cannot infer connector type"):
            Connector()


# ---------------------------------------------------------------------------
# 3. Auth imports
# ---------------------------------------------------------------------------


class TestAuthImports:
    """Ensure auth classes are importable from ``mcp_use.auth``."""

    def test_bearer_auth(self):
        from mcp_use.auth import BearerAuth

        assert BearerAuth is not None

    def test_oauth_auth_alias(self):
        from mcp_use.auth import OAuthAuth

        assert OAuthAuth is not None

    def test_oauth(self):
        from mcp_use.auth import OAuth

        assert OAuth is not None

    def test_oauth_auth_is_oauth(self):
        from mcp_use.auth import OAuth, OAuthAuth

        assert OAuthAuth is OAuth


# ---------------------------------------------------------------------------
# 4. Middleware imports
# ---------------------------------------------------------------------------


class TestMiddlewareImports:
    """Ensure middleware classes are importable from ``mcp_use.middleware``."""

    def test_logging_middleware(self):
        from mcp_use.middleware import LoggingMiddleware

        assert LoggingMiddleware is not None

    def test_performance_metrics_middleware(self):
        from mcp_use.middleware import PerformanceMetricsMiddleware

        assert PerformanceMetricsMiddleware is not None

    def test_middleware_base(self):
        from mcp_use.middleware import Middleware

        assert Middleware is not None

    def test_middleware_manager(self):
        from mcp_use.middleware import MiddlewareManager

        assert MiddlewareManager is not None


# ---------------------------------------------------------------------------
# 5. Server imports
# ---------------------------------------------------------------------------


class TestServerImports:
    """Ensure server classes are importable from ``mcp_use.server``."""

    def test_mcp_server(self):
        from mcp_use.server import MCPServer

        assert MCPServer is not None


# ---------------------------------------------------------------------------
# 6. Connector sub-package imports
# ---------------------------------------------------------------------------


class TestConnectorSubPackageImports:
    """Ensure connectors are importable from ``mcp_use.connectors``."""

    def test_connector_factory_from_connectors(self):
        from mcp_use.connectors import Connector

        assert callable(Connector)

    def test_connector_factory_from_client_connectors(self):
        from mcp_use.client.connectors import Connector

        assert callable(Connector)
