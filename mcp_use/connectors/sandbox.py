"""
Sandbox connector for MCP implementations.

This module provides a connector for communicating with MCP implementations
that are executed inside a sandbox environment (currently using E2B).
"""

import asyncio
import os
import sys
import time

import aiohttp
from mcp import ClientSession
from mcp.client.session import ElicitationFnT, LoggingFnT, MessageHandlerFnT, SamplingFnT

from ..logging import logger
from ..task_managers import SseConnectionManager

# Import E2B SDK components (optional dependency)
try:
    logger.debug("Attempting to import e2b_code_interpreter...")
    from e2b_code_interpreter import CommandHandle, Sandbox

    logger.debug("Successfully imported e2b_code_interpreter")
except ImportError as e:
    logger.debug(f"Failed to import e2b_code_interpreter: {e}")
    CommandHandle = None
    Sandbox = None

from ..types.sandbox import SandboxOptions
from .base import BaseConnector


class SandboxConnector(BaseConnector):
    """Connector for MCP implementations running in a sandbox environment.

    This connector runs a user-defined stdio command within a sandbox environment,
    currently implemented using E2B, potentially wrapped by a utility like 'supergateway'
    to expose its stdio.
    """

    def __init__(
        self,
        command: str,
        args: list[str],
        env: dict[str, str] | None = None,
        e2b_options: SandboxOptions | None = None,
        timeout: float = 5,
        sse_read_timeout: float = 60 * 5,
        sampling_callback: SamplingFnT | None = None,
        elicitation_callback: ElicitationFnT | None = None,
        message_handler: MessageHandlerFnT | None = None,
        logging_callback: LoggingFnT | None = None,
    ):
        """Initialize a new sandbox connector.

        Args:
            command: The user's MCP server command to execute in the sandbox.
            args: Command line arguments for the user's MCP server command.
            env: Environment variables for the user's MCP server command.
            e2b_options: Configuration options for the E2B sandbox environment.
                        See SandboxOptions for available options and defaults.
            timeout: Timeout for the sandbox process in seconds.
            sse_read_timeout: Timeout for the SSE connection in seconds.
            sampling_callback: Optional sampling callback.
            elicitation_callback: Optional elicitation callback.
        """
        super().__init__(
            sampling_callback=sampling_callback,
            elicitation_callback=elicitation_callback,
            message_handler=message_handler,
            logging_callback=logging_callback,
        )
        if Sandbox is None:
            raise ImportError(
                "E2B SDK (e2b-code-interpreter) not found. Please install it with "
                "'pip install mcp-use[e2b]' (or 'pip install e2b-code-interpreter')."
            )

        self.user_command = command
        self.user_args = args or []
        self.user_env = env or {}

        _e2b_options = e2b_options or {}

        self.api_key = _e2b_options.get("api_key") or os.environ.get("E2B_API_KEY")
        if not self.api_key:
            raise ValueError(
                "E2B API key is required. Provide it via 'sandbox_options.api_key'"
                " or the E2B_API_KEY environment variable."
            )

        self.sandbox_template_id = _e2b_options.get("sandbox_template_id", "base")
        self.supergateway_cmd_parts = _e2b_options.get("supergateway_command", "npx -y supergateway")

        self.sandbox: Sandbox | None = None
        self.process: CommandHandle | None = None
        self.client_session: ClientSession | None = None
        self.errlog = sys.stderr
        self.base_url: str | None = None
        self._connected = False
        self._connection_manager: SseConnectionManager | None = None

        # SSE connection parameters
        self.headers = {}
        self.timeout = timeout
        self.sse_read_timeout = sse_read_timeout

        self.stdout_lines: list[str] = []
        self.stderr_lines: list[str] = []
        self._server_ready = asyncio.Event()

    def _handle_stdout(self, data: str) -> None:
        """Handle stdout data from the sandbox process."""
        self.stdout_lines.append(data)
        logger.debug(f"[SANDBOX STDOUT] {data}", end="", flush=True)

    def _handle_stderr(self, data: str) -> None:
        """Handle stderr data from the sandbox process."""
        self.stderr_lines.append(data)
        logger.debug(f"[SANDBOX STDERR] {data}", file=self.errlog, end="", flush=True)

    async def wait_for_server_response(self, base_url: str, timeout: int = 30) -> bool:
        """Wait for the server to respond to HTTP requests.
        Args:
            base_url: The base URL to check for server readiness
            timeout: Maximum time to wait in seconds
        Returns:
            True if server is responding, raises TimeoutError otherwise
        """
        logger.info(f"Waiting for server at {base_url} to respond...")
        sys.stdout.flush()

        start_time = time.time()
        ping_url = f"{base_url}/sse"

        # Try to connect to the server
        while time.time() - start_time < timeout:
            try:
                async with aiohttp.ClientSession() as session:
                    try:
                        # First try the endpoint
                        async with session.get(ping_url, timeout=2) as response:
                            if response.status == 200:
                                elapsed = time.time() - start_time
                                logger.info(f"Server is ready! SSE endpoint responded with 200 after {elapsed:.1f}s")
                                return True
                    except Exception:
                        # If sse endpoint doesn't work, try the base URL
                        async with session.get(base_url, timeout=2) as response:
                            if response.status < 500:  # Accept any non-server error
                                elapsed = time.time() - start_time
                                logger.info(
                                    f"Server is ready! Base URL responded with {response.status} after {elapsed:.1f}s"
                                )
                                return True
            except Exception:
                # Wait a bit before trying again
                await asyncio.sleep(0.5)
                continue

            # If we get here, the request failed
            await asyncio.sleep(0.5)

            # Log status every 5 seconds
            elapsed = time.time() - start_time
            if int(elapsed) % 5 == 0:
                logger.info(f"Still waiting for server to respond... ({elapsed:.1f}s elapsed)")
                sys.stdout.flush()

        # If we get here, we timed out
        raise TimeoutError(f"Timeout waiting for server to respond (waited {timeout} seconds)")

    async def connect(self):
        """Connect to the sandbox and start the MCP server."""

        if self._connected:
            logger.debug("Already connected to MCP implementation")
            return

        logger.debug("Connecting to MCP implementation in sandbox")

        try:
            # Create and start the sandbox
            self.sandbox = Sandbox(
                template=self.sandbox_template_id,
                api_key=self.api_key,
            )

            # Get the host for the sandbox
            host = self.sandbox.get_host(3000)
            self.base_url = f"https://{host}".rstrip("/")

            # Append command with args
            command = f"{self.user_command} {' '.join(self.user_args)}"

            # Construct the full command with supergateway
            full_command = f'{self.supergateway_cmd_parts} \
                --base-url {self.base_url} \
                --port 3000 \
                --cors \
                --stdio "{command}"'

            logger.debug(f"Full command: {full_command}")

            # Start the process in the sandbox with our stdout/stderr handlers
            self.process: CommandHandle = self.sandbox.commands.run(
                full_command,
                envs=self.user_env,
                timeout=1000 * 60 * 10,  # 10 minutes timeout
                background=True,
                on_stdout=self._handle_stdout,
                on_stderr=self._handle_stderr,
            )

            # Wait for the server to be ready
            await self.wait_for_server_response(self.base_url, timeout=30)
            logger.debug("Initializing connection manager...")

            # Create the SSE connection URL
            sse_url = f"{self.base_url}/sse"

            # Create and start the connection manager
            self._connection_manager = SseConnectionManager(sse_url, self.headers, self.timeout, self.sse_read_timeout)
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
            logger.debug(f"Successfully connected to MCP implementation via HTTP/SSE: {self.base_url}")

        except Exception as e:
            logger.error(f"Failed to connect to MCP implementation: {e}")

            # Clean up any resources if connection failed
            await self._cleanup_resources()

            raise e

    async def _cleanup_resources(self) -> None:
        """Clean up all resources associated with this connector, including the sandbox.
        This method extends the base implementation to also terminate the sandbox instance
        and clean up any processes running in the sandbox.
        """
        logger.debug("Cleaning up sandbox resources")

        # Terminate any running process
        if self.process:
            try:
                logger.debug("Terminating sandbox process")
                self.process.kill()
            except Exception as e:
                logger.warning(f"Error terminating sandbox process: {e}")
            finally:
                self.process = None

        # Close the sandbox
        if self.sandbox:
            try:
                logger.debug("Closing sandbox instance")
                self.sandbox.kill()
                logger.debug("Sandbox instance closed successfully")
            except Exception as e:
                logger.warning(f"Error closing sandbox: {e}")
            finally:
                self.sandbox = None

        # Then call the parent method to clean up the rest
        await super()._cleanup_resources()

        # Clear any collected output
        self.stdout_lines = []
        self.stderr_lines = []
        self.base_url = None

    async def disconnect(self) -> None:
        """Close the connection to the MCP implementation."""
        if not self._connected:
            logger.debug("Not connected to MCP implementation")
            return

        logger.debug("Disconnecting from MCP implementation")
        await self._cleanup_resources()
        self._connected = False
        logger.debug("Disconnected from MCP implementation")

    @property
    def public_identifier(self) -> str:
        """Get the identifier for the connector."""
        return {"type": "sandbox", "command": self.user_command, "args": self.user_args}
