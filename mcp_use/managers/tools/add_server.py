"""Tool for dynamically adding MCP servers to the client."""

import logging
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class AddMCPServerToolSchema(BaseModel):
    """Schema for add_mcp_server tool input."""

    server_name: str = Field(description="Name for the new MCP server")
    server_config: dict[str, Any] = Field(description="Server configuration including command, args, and env")
    connect: bool = Field(
        default=True,
        description="Whether to immediately connect to the server after adding it",
    )


class AddMCPServerTool(StructuredTool):
    """Tool that allows adding new MCP servers dynamically."""

    name: str = "add_mcp_server"
    description: str = "Adds a new MCP server to the client and connects to it, making its tools available."
    args_schema: type[BaseModel] = AddMCPServerToolSchema

    def __init__(self, server_manager):
        """Initialize the tool with a reference to the ServerManager.

        Args:
            server_manager: The ServerManager instance to use
        """
        super().__init__(
            name=self.name,
            description=self.description,
            func=self._run,
            coroutine=self._arun,
            args_schema=self.args_schema,
        )
        self.manager = server_manager

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
            self.manager.client.add_server(server_name, server_config)

            if connect:
                logger.debug(f"Connecting to new server '{server_name}' and discovering tools")

                # Create a session for the new server
                session = await self.manager.client.create_session(server_name)

                # Get the connector from the session
                connector = session.connector

                # Create tools from the connector using the adapter
                tools = await self.manager.adapter.create_tools_from_connectors([connector])

                # Update ServerManager's state
                self.manager.server_tools[server_name] = tools
                self.manager.initialized_servers[server_name] = True
                self.manager.active_server = server_name

                success_msg = (
                    f"Successfully added and connected to server '{server_name}'. "
                    f"'{server_name}' is now the active server with {len(tools)} tools available."
                )
                logger.info(success_msg)
                return success_msg
            else:
                return f"Successfully added server '{server_name}' (not connected)"

        except Exception as e:
            error_msg = f"Failed to add server '{server_name}': {str(e)}"
            logger.error(error_msg, exc_info=True)
            return error_msg
