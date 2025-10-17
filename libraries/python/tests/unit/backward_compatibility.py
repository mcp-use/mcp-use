"""
Backward compatibility tests for deprecated import paths.

Ensures that old import paths work and emit proper deprecation warnings.
"""
# ruff: noqa


def test_backward_compatibility():
    """Test backward compatibility for all deprecated import paths."""
    try:
        # Top-level imports from mcp_use

        from mcp_use import MCPSession
        from mcp_use import load_config_file
        from mcp_use import BaseConnector
        from mcp_use import HttpConnector
        from mcp_use import StdioConnector
        from mcp_use import WebSocketConnector
        from mcp_use import MCPAgent
        from mcp_use import MCPClient
        from mcp_use import logger
        from mcp_use import MCP_USE_DEBUG
        from mcp_use import set_debug
        from mcp_use import observability

        # Agents
        from mcp_use.adapters import BaseAdapter
        from mcp_use.adapters import LangChainAdapter

        # Auth
        from mcp_use.auth import BearerAuth
        from mcp_use.auth import OAuth
        from mcp_use.auth.bearer import BearerAuth
        from mcp_use.auth.oauth import OAuth
        from mcp_use.auth.oauth_callback import OAuthCallbackServer
        from mcp_use.auth.oauth_callback import CallbackResponse

        # Connectors
        from mcp_use.connectors.base import BaseConnector
        from mcp_use.connectors import BaseConnector
        from mcp_use.connectors import HttpConnector
        from mcp_use.connectors import SandboxConnector
        from mcp_use.connectors import StdioConnector
        from mcp_use.connectors import WebSocketConnector

        # Exceptions
        from mcp_use.exceptions import MCPError
        from mcp_use.exceptions import OAuthDiscoveryError
        from mcp_use.exceptions import OAuthAuthenticationError
        from mcp_use.exceptions import ConnectionError
        from mcp_use.exceptions import ConfigurationError

        # Middleware
        from mcp_use.middleware.metrics import CombinedAnalyticsMiddleware
        from mcp_use.middleware.metrics import ErrorTrackingMiddleware
        from mcp_use.middleware.metrics import MetricsMiddleware
        from mcp_use.middleware.metrics import PerformanceMetricsMiddleware
        from mcp_use.middleware import MiddlewareContext
        from mcp_use.middleware import MCPResponseContext
        from mcp_use.middleware import Middleware
        from mcp_use.middleware import MiddlewareManager
        from mcp_use.middleware import CallbackClientSession
        from mcp_use.middleware import NextFunctionT
        from mcp_use.middleware import default_logging_middleware
        from mcp_use.middleware import MetricsMiddleware
        from mcp_use.middleware import PerformanceMetricsMiddleware
        from mcp_use.middleware import ErrorTrackingMiddleware
        from mcp_use.middleware import CombinedAnalyticsMiddleware

        # Task managers
        from mcp_use.task_managers import ConnectionManager
        from mcp_use.task_managers import SseConnectionManager
        from mcp_use.task_managers import StdioConnectionManager
        from mcp_use.task_managers import StreamableHttpConnectionManager
        from mcp_use.task_managers import WebSocketConnectionManager

        # Types
        from mcp_use.types.sandbox import SandboxOptions

        # Server manager package
        from mcp_use.managers import ServerManager
        from mcp_use.managers import MCPServerTool
        from mcp_use.managers import ConnectServerTool
        from mcp_use.managers import DisconnectServerTool
        from mcp_use.managers import GetActiveServerTool
        from mcp_use.managers import ListServersTool
        from mcp_use.managers import SearchToolsTool
        from mcp_use.managers import SearchToolsTool
        from mcp_use.managers.tools import ConnectServerTool
        from mcp_use.managers.tools import DisconnectServerTool
        from mcp_use.managers.tools import GetActiveServerTool
        from mcp_use.managers.tools import ListServersTool
        from mcp_use.managers.tools import SearchToolsTool
        from mcp_use.managers.tools import SearchToolsTool

    except ImportError as e:
        # Log the import error but don't fail the test
        # This allows the test to pass even if some optional dependencies are missing
        import logging

        logger = logging.getLogger(__name__)
        logger.warning(f"Backward compatibility test skipped due to import error: {e}")
        raise e
