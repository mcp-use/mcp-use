"""
Client for managing MCP servers and sessions.

This module provides a high-level client that manages MCP servers, connectors,
and sessions from configuration.
"""

import json
import warnings
from typing import TYPE_CHECKING, Any

from mcp.client.session import ElicitationFnT, LoggingFnT, MessageHandlerFnT, SamplingFnT

from mcp_use.client.config import create_connector_from_config, load_config_file
from mcp_use.client.code_mode_config import CodeModeConfig
from mcp_use.client.connectors.sandbox import SandboxOptions
from mcp_use.client.middleware import Middleware, default_logging_middleware
from mcp_use.client.session import MCPSession
from mcp_use.logging import logger
from mcp_use.telemetry.telemetry import Telemetry, telemetry

_telemetry = Telemetry()

if TYPE_CHECKING:
    from mcp_use.client.code_executor import CodeExecutor


class MCPClient:
    """Client for managing MCP servers and sessions.

    This class provides a unified interface for working with MCP servers,
    handling configuration, connector creation, and session management.
    """

    def __init__(
        self,
        config: str | dict[str, Any] | None = None,
        allowed_servers: list[str] | None = None,
        sandbox: bool = False,
        sandbox_options: SandboxOptions | None = None,
        sampling_callback: SamplingFnT | None = None,
        elicitation_callback: ElicitationFnT | None = None,
        message_handler: MessageHandlerFnT | None = None,
        logging_callback: LoggingFnT | None = None,
        middleware: list[Middleware] | None = None,
        code_mode: bool | CodeModeConfig = False,
        verify: bool | None = True,
    ) -> None:
        """Initialize a new MCP client.

        Args:
            config: Either a dict containing configuration or a path to a JSON config file.
                   If None, an empty configuration is used.
            sandbox: Whether to use sandboxed execution mode for running MCP servers.
            sandbox_options: Optional sandbox configuration options.
            sampling_callback: Optional sampling callback function.
            code_mode: Whether to enable code execution mode for tools, or a CodeModeConfig object.
        """
        self.config: dict[str, Any] = {}
        self.allowed_servers: list[str] = allowed_servers
        self.sandbox = sandbox
        self.sandbox_options = sandbox_options
        self.sessions: dict[str, MCPSession] = {}
        self.active_sessions: list[str] = []
        self.sampling_callback = sampling_callback
        self.elicitation_callback = elicitation_callback
        self.message_handler = message_handler
        self.logging_callback = logging_callback
        
        # Handle code_mode as bool or CodeModeConfig
        if isinstance(code_mode, bool):
            self.code_mode_config = CodeModeConfig.from_bool(code_mode)
        elif isinstance(code_mode, CodeModeConfig):
            self.code_mode_config = code_mode
        else:
            self.code_mode_config = CodeModeConfig.from_bool(False)
        
        self.code_mode = self.code_mode_config.enabled
        self._code_executor: CodeExecutor | None = None
        self._record_telemetry = True
        # Add default logging middleware if no middleware provided, or prepend it to existing middleware
        default_middleware = [default_logging_middleware]
        if middleware:
            self.middleware = default_middleware + middleware
        else:
            self.middleware = default_middleware
        self.verify = verify
        # Load configuration if provided
        if config is not None:
            if isinstance(config, str):
                self.config = load_config_file(config)
            else:
                self.config = config

        # If code mode is enabled, create internal code mode connector
        if self.code_mode:
            self._setup_code_mode_connector()

        servers_list = list(self.config.get("mcpServers", {}).keys()) if self.config else []
        _telemetry.track_client_init(
            code_mode=self.code_mode,
            sandbox=self.sandbox,
            all_callbacks=(
                self.sampling_callback is not None
                and self.elicitation_callback is not None
                and self.message_handler is not None
                and self.logging_callback is not None
            ),
            verify=self.verify if self.verify is not None else True,
            servers=servers_list,
            num_servers=len(servers_list),
        )

    @classmethod
    def from_dict(
        cls,
        config: dict[str, Any],
        sandbox: bool = False,
        sandbox_options: SandboxOptions | None = None,
        sampling_callback: SamplingFnT | None = None,
        elicitation_callback: ElicitationFnT | None = None,
        message_handler: MessageHandlerFnT | None = None,
        logging_callback: LoggingFnT | None = None,
        code_mode: bool | CodeModeConfig = False,
        verify: bool | None = True,
    ) -> "MCPClient":
        """Create a MCPClient from a dictionary.

        Args:
            config: The configuration dictionary.
            sandbox: Whether to use sandboxed execution mode for running MCP servers.
            sandbox_options: Optional sandbox configuration options.
            sampling_callback: Optional sampling callback function.
            elicitation_callback: Optional elicitation callback function.
            code_mode: Whether to enable code execution mode for tools, or a CodeModeConfig object.
        """
        return cls(
            config=config,
            sandbox=sandbox,
            sandbox_options=sandbox_options,
            sampling_callback=sampling_callback,
            elicitation_callback=elicitation_callback,
            message_handler=message_handler,
            logging_callback=logging_callback,
            code_mode=code_mode,
            verify=verify,
        )

    @classmethod
    def from_config_file(
        cls,
        filepath: str,
        sandbox: bool = False,
        sandbox_options: SandboxOptions | None = None,
        sampling_callback: SamplingFnT | None = None,
        elicitation_callback: ElicitationFnT | None = None,
        message_handler: MessageHandlerFnT | None = None,
        logging_callback: LoggingFnT | None = None,
        code_mode: bool | CodeModeConfig = False,
        verify: bool | None = True,
    ) -> "MCPClient":
        """Create a MCPClient from a configuration file.

        Args:
            filepath: The path to the configuration file.
            sandbox: Whether to use sandboxed execution mode for running MCP servers.
            sandbox_options: Optional sandbox configuration options.
            sampling_callback: Optional sampling callback function.
            elicitation_callback: Optional elicitation callback function.
            code_mode: Whether to enable code execution mode for tools, or a CodeModeConfig object.
        """
        return cls(
            config=load_config_file(filepath),
            sandbox=sandbox,
            sandbox_options=sandbox_options,
            sampling_callback=sampling_callback,
            elicitation_callback=elicitation_callback,
            message_handler=message_handler,
            logging_callback=logging_callback,
            code_mode=code_mode,
            verify=verify,
        )

    @telemetry("client_add_server")
    def add_server(
        self,
        name: str,
        server_config: dict[str, Any],
    ) -> None:
        """Add a server configuration.

        Args:
            name: The name to identify this server.
            server_config: The server configuration.
        """
        if "mcpServers" not in self.config:
            self.config["mcpServers"] = {}

        self.config["mcpServers"][name] = server_config

    @telemetry("client_remove_server")
    def remove_server(self, name: str) -> None:
        """Remove a server configuration.

        Args:
            name: The name of the server to remove.
        """
        if "mcpServers" in self.config and name in self.config["mcpServers"]:
            del self.config["mcpServers"][name]

            # If we removed an active session, remove it from active_sessions
            if name in self.active_sessions:
                self.active_sessions.remove(name)

    def add_middleware(self, middleware: Middleware) -> None:
        """Add a middleware.

        Args:
            middleware: The middleware to add
        """
        if len(self.sessions) == 0 and middleware not in self.middleware:
            self.middleware.append(middleware)
            return

        if middleware not in self.middleware:
            self.middleware.append(middleware)
            for session in self.sessions.values():
                session.connector.middleware_manager.add_middleware(middleware)

    def _setup_code_mode_connector(self) -> None:
        """Setup internal code mode connector as a meta MCP server.

        This creates a special internal session that provides code execution
        tools, treating them as if they came from an MCP server.
        """
        from mcp_use.client.connectors.code_mode import CodeModeConnector

        # Create code mode connector
        code_connector = CodeModeConnector(self)

        # Create a session for it
        code_session = MCPSession(code_connector)

        # Register it as a special internal server
        # Use valid identifier name (no double underscores)
        self.sessions["code_mode"] = code_session
        self.active_sessions.append("code_mode")

        logger.debug("Code mode connector initialized as internal meta server")

    def get_server_names(self) -> list[str]:
        """Get the list of configured server names.

        Returns:
            List of server names (excludes internal code mode server).
        """
        servers = list(self.config.get("mcpServers", {}).keys())
        # Don't expose internal code mode server in server list
        return servers

    def save_config(self, filepath: str) -> None:
        """Save the current configuration to a file.

        Args:
            filepath: The path to save the configuration to.
        """
        with open(filepath, "w") as f:
            json.dump(self.config, f, indent=2)

    @telemetry("client_create_session")
    async def create_session(self, server_name: str, auto_initialize: bool = True) -> MCPSession | None:
        """Create a session for the specified server.

        Args:
            server_name: The name of the server to create a session for.
            auto_initialize: Whether to automatically initialize the session.

        Returns:
            The created MCPSession.

        Raises:
            ValueError: If the specified server doesn't exist.
        """
        # Get server config
        servers = self.config.get("mcpServers", {})
        if not servers:
            warnings.warn("No MCP servers defined in config", UserWarning, stacklevel=2)
            return None

        if server_name not in servers:
            raise ValueError(f"Server '{server_name}' not found in config")

        server_config = servers[server_name]

        # Create connector with options and client-level auth
        connector = create_connector_from_config(
            server_config,
            sandbox=self.sandbox,
            sandbox_options=self.sandbox_options,
            sampling_callback=self.sampling_callback,
            elicitation_callback=self.elicitation_callback,
            message_handler=self.message_handler,
            logging_callback=self.logging_callback,
            middleware=self.middleware,
        )

        # Create the session
        session = MCPSession(connector)
        session._record_telemetry = False
        connector._record_telemetry = False
        if auto_initialize:
            await session.initialize()
        self.sessions[server_name] = session

        # Add to active sessions
        if server_name not in self.active_sessions:
            self.active_sessions.append(server_name)

        return session

    @telemetry("client_create_all_sessions")
    async def create_all_sessions(
        self,
        auto_initialize: bool = True,
    ) -> dict[str, MCPSession]:
        """Create sessions for all configured servers.

        Args:
            auto_initialize: Whether to automatically initialize the sessions.

        Returns:
            Dictionary mapping server names to their MCPSession instances.

        Warns:
            UserWarning: If no servers are configured.
        """
        # Get server config
        servers = self.config.get("mcpServers", {})
        if not servers:
            warnings.warn("No MCP servers defined in config", UserWarning, stacklevel=2)
            return {}

        # Create sessions only for allowed servers if applicable else create for all servers
        for name in servers:
            if self.allowed_servers is None or name in self.allowed_servers:
                await self.create_session(name, auto_initialize)

        # If code mode is enabled, only expose the code mode session externally
        # Internal components (like CodeExecutor) access self.sessions directly
        if self.code_mode:
            return {
                name: sess
                for name, sess in self.sessions.items()
                if getattr(sess.connector, "public_identifier", "") == "code_mode:internal"
            }

        return self.sessions

    def get_session(self, server_name: str) -> MCPSession:
        """Get an existing session.

        Args:
            server_name: The name of the server to get the session for.
                        If None, uses the first active session.

        Returns:
            The MCPSession for the specified server.

        Raises:
            ValueError: If no active sessions exist or the specified session doesn't exist.
        """
        if server_name not in self.sessions:
            raise ValueError(f"No session exists for server '{server_name}'")

        return self.sessions[server_name]

    def get_all_active_sessions(self) -> dict[str, MCPSession]:
        """Get all active sessions.

        Returns:
            Dictionary mapping server names to their MCPSession instances.
        """
        # If code mode is enabled, only expose the code mode session externally
        # Internal components (like CodeExecutor) access self.sessions directly
        if self.code_mode:
            return {
                name: sess
                for name, sess in self.sessions.items()
                if getattr(sess.connector, "public_identifier", "") == "code_mode:internal"
            }

        return {name: self.sessions[name] for name in self.active_sessions if name in self.sessions}

    async def close_session(self, server_name: str) -> None:
        """Close a session.

        Args:
            server_name: The name of the server to close the session for.
                        If None, uses the first active session.

        Raises:
            ValueError: If no active sessions exist or the specified session doesn't exist.
        """
        # Check if the session exists
        if server_name not in self.sessions:
            logger.warning(f"No session exists for server '{server_name}', nothing to close")
            return

        # Get the session
        session = self.sessions[server_name]

        try:
            # Disconnect from the session
            logger.debug(f"Closing session for server '{server_name}'")
            await session.disconnect()
        except Exception as e:
            logger.error(f"Error closing session for server '{server_name}': {e}")
        finally:
            # Remove the session regardless of whether disconnect succeeded
            del self.sessions[server_name]

            # Remove from active_sessions
            if server_name in self.active_sessions:
                self.active_sessions.remove(server_name)

    async def close_all_sessions(self) -> None:
        """Close all active sessions.

        This method ensures all sessions are closed even if some fail.
        """
        # Get a list of all session names first to avoid modification during iteration
        server_names = list(self.sessions.keys())
        errors = []

        for server_name in server_names:
            try:
                logger.debug(f"Closing session for server '{server_name}'")
                await self.close_session(server_name)
            except Exception as e:
                error_msg = f"Failed to close session for server '{server_name}': {e}"
                logger.error(error_msg)
                errors.append(error_msg)

        # Log summary if there were errors
        if errors:
            logger.error(f"Encountered {len(errors)} errors while closing sessions")
        else:
            logger.debug("All sessions closed successfully")

    async def execute_code(self, code: str, timeout: float = 30.0) -> dict[str, Any]:
        """Execute Python code with access to MCP tools (code mode).

        This method allows agents to interact with MCP tools through Python code
        instead of direct tool calls, enabling more efficient context usage and
        data processing.

        Args:
            code: Python code to execute with tool access.
            timeout: Execution timeout in seconds.

        Returns:
            Dictionary with keys:
                - result: The return value from the code
                - logs: List of captured print statements
                - error: Error message if execution failed (None on success)
                - execution_time: Time taken to execute in seconds

        Raises:
            RuntimeError: If code_mode is not enabled.

        Example:
            ```python
            client = MCPClient(config="config.json", code_mode=True)
            await client.create_all_sessions()

            result = await client.execute_code('''
            tools = await search_tools("github")
            print(f"Found {len(tools)} tools")

            pr = await github.get_pull_request(
                owner="facebook",
                repo="react",
                number=12345
            )
            return {"title": pr["title"]}
            ''')

            print(result['result'])  # {'title': 'Fix bug in...'}
            print(result['logs'])    # ['Found 5 tools']
            ```
        """
        if not self.code_mode:
            raise RuntimeError(
                "Code execution mode is not enabled. Create the client with code_mode=True to use execute_code()."
            )

        # Lazy import to avoid circular dependency
        if self._code_executor is None:
            from mcp_use.client.code_executor import CodeExecutor

            self._code_executor = CodeExecutor(self, self.code_mode_config)

        return await self._code_executor.execute(code, timeout)

    async def search_tools(self, query: str = "", detail_level: str = "full") -> dict[str, Any]:
        """Search available MCP tools across all active sessions.

        Args:
            query: Search query to filter tools by name or description.
            detail_level: Level of detail to return:
                - "names": Only tool names and server
                - "descriptions": Names, server, and descriptions
                - "full": Complete tool information including schemas

        Returns:
            Dictionary with:
            - meta: Dictionary containing total_tools, namespaces, and result_count
            - results: List of tool information dictionaries matching the query
        Example:
            ```python
            # Search for GitHub-related tools
            result = await client.search_tools("github pull")
            print(f"Found {result['meta']['result_count']} tools out of {result['meta']['total_tools']} total")
            for tool in result['results']:
                print(f"{tool['server']}.{tool['name']}: {tool['description']}")
            ```
        """
        # Ensure all servers are connected if in code mode (lazy connection)
        if self.code_mode:
            configured = set(self.get_server_names())
            active = set(self.sessions.keys())
            if not configured.issubset(active):
                logger.debug("Connecting to configured servers for tool search...")
                await self.create_all_sessions()

        all_tools = []
        all_namespaces = set()
        query_lower = query.lower()

        # First pass: collect all tools and namespaces
        for server_name, session in self.sessions.items():
            try:
                tools = await session.list_tools()
                if tools:
                    all_namespaces.add(server_name)

                for tool in tools:
                    # Build tool info based on detail level (before filtering)
                    if detail_level == "names":
                        tool_info = {
                            "name": tool.name,
                            "server": server_name,
                        }
                    elif detail_level == "descriptions":
                        tool_info = {
                            "name": tool.name,
                            "server": server_name,
                            "description": getattr(tool, "description", ""),
                        }
                    else:  # full
                        tool_info = {
                            "name": tool.name,
                            "server": server_name,
                            "description": getattr(tool, "description", ""),
                            "input_schema": getattr(tool, "inputSchema", {}),
                        }

                    all_tools.append(tool_info)

            except Exception as e:
                logger.error(f"Failed to list tools for server {server_name}: {e}")

        # Filter by query if provided
        filtered_tools = all_tools
        if query:
            filtered_tools = []
            for tool_info in all_tools:
                tool_name_match = query_lower in tool_info["name"].lower()
                desc_match = query_lower in tool_info.get("description", "").lower()
                server_match = query_lower in tool_info["server"].lower()
                if tool_name_match or desc_match or server_match:
                    filtered_tools.append(tool_info)

        # Return metadata along with results
        return {
            "meta": {
                "total_tools": len(all_tools),
                "namespaces": sorted(list(all_namespaces)),
                "result_count": len(filtered_tools),
            },
            "results": filtered_tools,
        }
