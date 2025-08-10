"""
StdIO connector for MCP implementations.

This module provides a connector for communicating with MCP implementations
through the standard input/output streams.
"""

import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.session import ElicitationFnT, LoggingFnT, MessageHandlerFnT, SamplingFnT

from ..logging import logger
from ..task_managers import StdioConnectionManager
from .base import BaseConnector


class StdioConnector(BaseConnector):
    """Connector for MCP implementations using stdio transport.

    This connector uses the stdio transport to communicate with MCP implementations
    that are executed as child processes. It uses a connection manager to handle
    the proper lifecycle management of the stdio client.
    """

    def __init__(
        self,
        command: str = "npx",
        args: list[str] | None = None,
        env: dict[str, str] | None = None,
        errlog=sys.stderr,
        sampling_callback: SamplingFnT | None = None,
        elicitation_callback: ElicitationFnT | None = None,
        message_handler: MessageHandlerFnT | None = None,
        logging_callback: LoggingFnT | None = None,
    ):
        """Initialize a new stdio connector.

        Args:
            command: The command to execute.
            args: Optional command line arguments.
            env: Optional environment variables.
            errlog: Stream to write error output to.
            sampling_callback: Optional callback to sample the client.
            elicitation_callback: Optional callback to elicit the client.
        """
        super().__init__(
            sampling_callback=sampling_callback,
            elicitation_callback=elicitation_callback,
            message_handler=message_handler,
            logging_callback=logging_callback,
        )
        self.command = command
        self.args = args or []  # Ensure args is never None
        self.env = env
        self.errlog = errlog

    async def connect(self) -> None:
        """Establish a connection to the MCP implementation."""
        if self._connected:
            logger.debug("Already connected to MCP implementation")
            return

        logger.debug(f"Connecting to MCP implementation: {self.command}")
        try:
            # Create server parameters
            server_params = StdioServerParameters(command=self.command, args=self.args, env=self.env)

            # Create and start the connection manager
            self._connection_manager = StdioConnectionManager(server_params, self.errlog)
            read_stream, write_stream = await self._connection_manager.start()

            # Create the client session
            self.client_session = ClientSession(
                read_stream,
                write_stream,
                sampling_callback=self.sampling_callback,
                elicitation_callback=self.elicitation_callback,
                message_handler=self._internal_message_handler,
                logging_callback=self.logging_callback,
                client_info=self.client_info,
            )
            await self.client_session.__aenter__()

            # Mark as connected
            self._connected = True
            logger.debug(f"Successfully connected to MCP implementation: {self.command}")

        except Exception as e:
            logger.error(f"Failed to connect to MCP implementation: {e}")

            # Clean up any resources if connection failed
            await self._cleanup_resources()

            # Re-raise the original exception
            raise

    @property
    def public_identifier(self) -> str:
        """Get the identifier for the connector."""
        return {"type": "stdio", "command&args": f"{self.command} {' '.join(self.args)}"}
