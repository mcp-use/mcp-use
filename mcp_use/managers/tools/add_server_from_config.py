"""Tool for dynamically adding MCP servers to the client."""

import logging
from typing import Any, ClassVar

from pydantic import BaseModel, Field

from mcp_use.managers.tools.base_tool import MCPServerTool

logger = logging.getLogger(__name__)


class AddMCPServerFromConfigToolSchema(BaseModel):
    """Schema for add_mcp_server_from_config tool input."""

    server_name: str = Field(description="Name for the new MCP server")
    server_config: dict[str, Any] = Field(description="Server configuration including command, args, and env")


class AddMCPServerFromConfigTool(MCPServerTool):
    """Tool that allows adding new MCP servers dynamically."""

    name: ClassVar[str] = "add_mcp_server_from_config"
    description: ClassVar[str] = "Adds a new MCP server to the client and connects to it, making its tools available."
    args_schema: ClassVar[type[BaseModel]] = AddMCPServerFromConfigToolSchema

    def _run(self, server_name: str, server_config: dict[str, Any], connect: bool = True) -> str:
        """Synchronous version - not implemented as this is an async operation."""
        raise NotImplementedError("This tool only supports async execution")

    async def _arun(self, server_name: str, server_config: dict[str, Any], connect: bool = True) -> str:
        """Add a new MCP server to the client and optionally connect to it.

        Args:
            server_name: Name for the new server
            server_config: Server configuration dict
            connect: Whether to immediately connect

        Returns:
            Success or error message
        """
        try:
            # Add the server to the client
            self.server_manager.client.add_server(server_name, server_config)

            logger.debug(f"Connecting to new server '{server_name}' and discovering tools")

            # Create a session for the new server
            session = await self.server_manager.client.create_session(server_name)

            # Get the connector from the session
            connector = session.connector

            # Create tools from the connector using the adapter
            tools = await self.server_manager.adapter.create_tools_from_connectors([connector])

            # Update ServerManager's state
            self.server_manager.server_tools[server_name] = tools
            self.server_manager.initialized_servers[server_name] = True
            self.server_manager.active_server = server_name

            success_msg = (
                f"Successfully added and connected to server '{server_name}'. "
                f"'{server_name}' is now the active server with {len(tools)} tools available."
            )
            logger.info(success_msg)
            return success_msg

        except Exception as e:
            error_msg = f"Failed to add server '{server_name}': {str(e)}"
            logger.error(error_msg, exc_info=True)
            return error_msg
