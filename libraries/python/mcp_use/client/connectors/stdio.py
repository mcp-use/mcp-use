"""
StdIO connector for MCP implementations.

This module provides a connector for communicating with MCP implementations
through the standard input/output streams.
"""

import sys
from typing import Any

from mcp import ClientSession, ErrorData, McpError, StdioServerParameters
from mcp.client.session import ElicitationFnT, ListRootsFnT, LoggingFnT, MessageHandlerFnT, SamplingFnT
from mcp.types import CONNECTION_CLOSED, Root

from mcp_use.client.connectors.base import BaseConnector
from mcp_use.client.middleware import CallbackClientSession, Middleware
from mcp_use.client.task_managers import StdioConnectionManager
from mcp_use.logging import logger


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
        middleware: list[Middleware] | None = None,
        roots: list[Root] | None = None,
        list_roots_callback: ListRootsFnT | None = None,
    ):
        """Initialize a new stdio connector.

        Args:
            command: The command to execute.
            args: Optional command line arguments.
            env: Optional environment variables.
            errlog: Stream to write error output to.
            sampling_callback: Optional callback to sample the client.
            elicitation_callback: Optional callback to elicit the client.
            message_handler: Optional callback to handle messages.
            logging_callback: Optional callback to handle log messages.
            middleware: Optional list of middleware.
            roots: Optional initial list of roots to advertise to the server.
            list_roots_callback: Optional custom callback to handle roots/list requests.
        """
        super().__init__(
            sampling_callback=sampling_callback,
            elicitation_callback=elicitation_callback,
            message_handler=message_handler,
            logging_callback=logging_callback,
            middleware=middleware,
            roots=roots,
            list_roots_callback=list_roots_callback,
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
            raw_client_session = ClientSession(
                read_stream,
                write_stream,
                sampling_callback=self.sampling_callback,
                elicitation_callback=self.elicitation_callback,
                list_roots_callback=self.list_roots_callback,
                message_handler=self._internal_message_handler,
                logging_callback=self.logging_callback,
                client_info=self.client_info,
            )
            await raw_client_session.__aenter__()

            # Wrap with middleware
            self.client_session = CallbackClientSession(
                raw_client_session, self.public_identifier, self.middleware_manager
            )

            # Mark as connected
            self._connected = True
            logger.debug(f"Successfully connected to MCP implementation: {self.command}")

        except OSError as e:
            # Process could not be started at all
            logger.error(
                f"Failed to start stdio MCP server {self.public_identifier}"
                f"with command {self.command} and args {self.args}"
            )

            # Clean up any resources if connection failed
            await self._cleanup_resources()

            # Re-raise runtime error
            raise RuntimeError(
                "Failed to start stdio MCP server "
                f"'{self.public_identifier}'. "
                f"Ensure '{self.command}' is installed and on PATH. "
                f"Original error: {e}"
            ) from e

        except Exception as e:
            logger.error(f"Failed to connect to stdio MCP server {self.public_identifier}: {e}")
            await self._cleanup_resources()
            raise

    async def initialize(self) -> dict[str, Any]:
        """
        Initialize the MCP session for stdio servers with richer error messages.

        In particular, wraps McpError(CONNECTION_CLOSED) to include the stdio
        command/args and guidance to inspect stderr.
        """
        if not self.client_session:
            raise RuntimeError("MCP client is not connected")

        try:
            # Delegate to BaseConnector.initialize (which handles capabilities + lists)
            return await super().initialize()

        except McpError as e:
            err = getattr(e, "error", None)

            # The common case when the server process starts, prints an error,
            # and exits during initialize() (e.g. invalid CLI flag)
            if err is not None and err.code == CONNECTION_CLOSED:
                cmd = f"{self.command} {' '.join(self.args)}".strip()

                message = (
                    f"Failed to initialize stdio MCP server '{self.public_identifier}': "
                    "the underlying process closed the connection during initialization.\n"
                    f"Command: {cmd}\n"
                    "This usually means the server failed to start correctly or crashed "
                    "(for example, due to an invalid CLI flag or runtime error).\n"
                    "Check the server's stderr output above for details."
                )

                raise McpError(
                    ErrorData(
                        code=err.code,
                        message=message,
                        data={
                            "public_identifier": self.public_identifier,
                            "command": self.command,
                            "args": self.args,
                            "phase": "initialize",
                        },
                    )
                ) from e

            # For other MCP errors, just re-raise
            raise

    @property
    def public_identifier(self) -> str:
        """Get the identifier for the connector."""
        return f"stdio:{self.command} {' '.join(self.args)}"
