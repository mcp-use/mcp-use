from langchain_core.tools import BaseTool

from mcp_use.client import MCPClient
from mcp_use.logging import logger

from ..adapters.base import BaseAdapter
from .tools import ConnectServerTool, DisconnectServerTool, GetActiveServerTool, ListServersTool, SearchToolsTool


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
        self._server_tools: dict[str, list[BaseTool]] = {}

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
                    if server_name not in self._server_tools or self._server_tools[server_name] != tools:
                        self._server_tools[server_name] = tools  # Cache tools
                        self.initialized_servers[server_name] = True  # Mark as initialized
                        logger.debug(f"Prefetched {len(tools)} tools for server '{server_name}'.")
                    else:
                        logger.debug(f"Tools for server '{server_name}' unchanged, using cached version.")
            except Exception as e:
                logger.error(f"Error prefetching tools for server '{server_name}': {e}")

    def get_active_server_tools(self) -> list[BaseTool]:
        """Get tools from the currently active server.

        Returns:
            List of tools from the active server, or empty list if no server is active
        """
        if self.active_server and self.active_server in self._server_tools:
            return self._server_tools[self.active_server]
        return []

    def get_management_tools(self) -> list[BaseTool]:
        """Get the server management tools.

        Returns:
            List of server management tools
        """
        return [
            ListServersTool(self),
            ConnectServerTool(self),
            GetActiveServerTool(self),
            DisconnectServerTool(self),
            SearchToolsTool(self),
        ]

    def has_tool_changes(self, current_tool_names: set[str]) -> bool:
        """Check if the available tools have changed.

        Args:
            current_tool_names: Set of currently known tool names

        Returns:
            True if tools have changed, False otherwise
        """
        new_tool_names = {tool.name for tool in self.tools}
        return new_tool_names != current_tool_names

    @property
    def tools(self) -> list[BaseTool]:
        """Get all server management tools and tools from the active server.

        Returns:
            list of LangChain tools for server management plus tools from active server
        """
        management_tools = self.get_management_tools()

        # Add tools from the active server if available
        if self.active_server and self.active_server in self._server_tools:
            server_tools = self._server_tools[self.active_server]
            logger.debug(f"Including {len(server_tools)} tools from active server '{self.active_server}'")
            logger.debug(f"Server tools: {[tool.name for tool in server_tools]}")
            return management_tools + server_tools
        else:
            logger.debug("No active server - returning only management tools")

        return management_tools
