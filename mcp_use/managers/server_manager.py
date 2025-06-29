from langchain_core.tools import BaseTool

from mcp_use.client import MCPClient
from mcp_use.logging import logger

from ..adapters.base import BaseAdapter
from .tools import (
    AddMCPServerTool,
    ConnectServerTool,
    DisconnectServerTool,
    GetActiveServerTool,
    ListServersTool,
    SearchToolsTool,
    UseToolFromServerTool,
)


class ServerManager:
    """Manages MCP servers and provides tools for server selection and management.

    This class allows an agent to discover and select which MCP server to use,
    dynamically activating the tools for the selected server.
    """

    def __init__(self, client: MCPClient, adapter: BaseAdapter) -> None:
        """Initialize the server manager.

        Args:
            client: The MCPClient instance managing server connections
            adapter: The LangChainAdapter for converting MCP tools to LangChain tools
        """
        self.client = client
        self.adapter = adapter
        self.active_server: str | None = None
        self.initialized_servers: dict[str, bool] = {}
        self.server_tools: dict[str, list[BaseTool]] = {}

    async def initialize(self) -> None:
        """Initialize the server manager and prepare server management tools."""
        # Make sure we have server configurations
        if not self.client.get_server_names():
            logger.warning("No MCP servers defined in client configuration")

    async def _prefetch_server_tools(self) -> None:
        """Pre-fetch tools for all servers to populate the tool search index."""
        servers = self.client.get_server_names()
        for server_name in servers:
            try:
                # Only create session if needed, don't set active
                session = None
                try:
                    session = self.client.get_session(server_name)
                    logger.debug(f"Using existing session for server '{server_name}' to prefetch tools.")
                except ValueError:
                    try:
                        session = await self.client.create_session(server_name)
                        logger.debug(f"Temporarily created session for '{server_name}' to prefetch tools")
                    except Exception:
                        logger.warning(f"Could not create session for '{server_name}' during prefetch")
                        continue

                # Fetch tools if session is available
                if session:
                    connector = session.connector
                    tools = await self.adapter._create_tools_from_connectors([connector])

                    # Check if this server's tools have changed
                    if server_name not in self.server_tools or self.server_tools[server_name] != tools:
                        self.server_tools[server_name] = tools  # Cache tools
                        self.initialized_servers[server_name] = True  # Mark as initialized
                        logger.debug(f"Prefetched {len(tools)} tools for server '{server_name}'.")
                    else:
                        logger.debug(f"Tools for server '{server_name}' unchanged, using cached version.")
            except Exception as e:
                logger.error(f"Error prefetching tools for server '{server_name}': {e}")

    def log_state(self, context: str) -> None:
        """Log the current state of all servers for debugging.

        Args:
            context: Context string for the log message
        """
        logger.debug(f"\n=== ServerManager State ({context}) ===")
        server_names = self.client.get_server_names()

        if not server_names:
            logger.debug("No servers configured")
            return

        for server_name in server_names:
            # Check connection status
            try:
                session = self.client.get_session(server_name)
                connected = session is not None
            except ValueError:
                connected = False

            # Get other status info
            initialized = self.initialized_servers.get(server_name, False)
            tool_count = len(self.server_tools.get(server_name, []))
            is_active = server_name == self.active_server

            status = []
            if connected:
                status.append("connected")
            if initialized:
                status.append("initialized")
            if is_active:
                status.append("ACTIVE")

            logger.debug(f"  - {server_name}: {', '.join(status) if status else 'not connected'} ({tool_count} tools)")
        logger.debug("==========================\n")

    @property
    def tools(self) -> list[BaseTool]:
        """Get all available tools including server management and active server tools.

        Returns:
            Combined list of management tools and active server tools
        """
        # Log current state for debugging
        if logger.level <= 10:  # DEBUG level
            self.log_state("tools getter")

        # Base management tools
        management_tools = [
            AddMCPServerTool(self),
            ListServersTool(self),
            ConnectServerTool(self),
            GetActiveServerTool(self),
            DisconnectServerTool(self),
            SearchToolsTool(self),
            UseToolFromServerTool(self),
        ]

        # If there's an active server, include its tools
        if self.active_server and self.active_server in self.server_tools:
            active_tools = self.server_tools[self.active_server]
            return management_tools + active_tools

        return management_tools
