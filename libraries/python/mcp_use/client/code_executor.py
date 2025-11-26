"""
Code execution engine for MCP tools.

This module provides secure code execution capabilities for MCP clients,
allowing agents to interact with tools through Python code instead of
direct tool calls.
"""

import asyncio
import io
import re
import time
from contextlib import redirect_stderr, redirect_stdout
from typing import TYPE_CHECKING, Any

from mcp_use.logging import logger

if TYPE_CHECKING:
    from mcp_use.client.client import MCPClient


class CodeExecutor:
    """Executes Python code with access to MCP tools in a restricted namespace.

    This class provides a secure execution environment where agent-written code
    can call MCP tools through dynamically generated wrapper functions.
    """

    def __init__(self, client: "MCPClient"):
        """Initialize the code executor.

        Args:
            client: The MCPClient instance to use for tool calls.
        """
        self.client = client
        self._tool_cache: dict[str, dict[str, Any]] = {}

    async def execute(self, code: str, timeout: float = 30.0) -> dict[str, Any]:
        """Execute Python code with access to MCP tools.

        Args:
            code: Python code to execute.
            timeout: Execution timeout in seconds.

        Returns:
            Dictionary with keys:
                - result: The return value from the code
                - logs: List of captured print statements
                - error: Error message if execution failed (None on success)
                - execution_time: Time taken to execute in seconds
        """
        # Ensure all servers are connected (lazy connection)
        # We check client.sessions directly to see internal state
        configured_servers = set(self.client.get_server_names())
        active_sessions = set(self.client.sessions.keys())

        # If any configured server is missing from sessions, trigger connection
        if not configured_servers.issubset(active_sessions):
            logger.debug("Connecting to configured servers for code execution...")
            await self.client.create_all_sessions()

        start_time = time.time()
        logs: list[str] = []
        result = None
        error = None

        # Capture stdout/stderr
        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()

        try:
            # Build execution namespace
            namespace = await self._build_namespace()

            # Add print capture function
            def captured_print(*args, **kwargs):
                output = io.StringIO()
                print(*args, file=output, **kwargs)
                log_message = output.getvalue().rstrip("\n")
                logs.append(log_message)

            namespace["print"] = captured_print

            # Execute code with timeout
            with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
                try:
                    result = await asyncio.wait_for(self._execute_code(code, namespace), timeout=timeout)
                except TimeoutError:
                    error = f"Execution timeout after {timeout} seconds"
                    logger.warning(f"Code execution timeout: {timeout}s")

        except Exception as e:
            error = str(e)
            logger.error(f"Code execution error: {e}")

        execution_time = time.time() - start_time

        # Capture any stdout/stderr that wasn't captured by our print wrapper
        if stdout_capture.getvalue():
            logs.extend(stdout_capture.getvalue().strip().split("\n"))
        if stderr_capture.getvalue():
            logs.extend([f"[ERROR] {line}" for line in stderr_capture.getvalue().strip().split("\n")])

        return {"result": result, "logs": logs, "error": error, "execution_time": execution_time}

    async def _execute_code(self, code: str, namespace: dict[str, Any]) -> Any:
        """Execute code in the given namespace.

        Args:
            code: Python code to execute.
            namespace: Execution namespace with restricted globals.

        Returns:
            The return value from executing the code.
        """
        # Always wrap code in an async function to support top-level await
        # and return statements
        wrapped_code = "async def __execute_wrapper__():\n"
        for line in code.split("\n"):
            wrapped_code += f"    {line}\n"

        # Compile and execute the wrapper function definition
        compiled_wrapped = compile(wrapped_code, "<agent_code>", "exec")
        exec(compiled_wrapped, namespace)

        # Execute the wrapper and return its result
        return await namespace["__execute_wrapper__"]()

    async def _build_namespace(self) -> dict[str, Any]:
        """Build restricted namespace with tool wrappers.

        Returns:
            Dictionary containing safe builtins and tool wrappers.
        """
        # Start with safe builtins
        safe_builtins = {
            "print": print,
            "len": len,
            "range": range,
            "enumerate": enumerate,
            "zip": zip,
            "map": map,
            "filter": filter,
            "list": list,
            "dict": dict,
            "set": set,
            "tuple": tuple,
            "str": str,
            "int": int,
            "float": float,
            "bool": bool,
            "abs": abs,
            "min": min,
            "max": max,
            "sum": sum,
            "sorted": sorted,
            "any": any,
            "all": all,
            "isinstance": isinstance,
            "hasattr": hasattr,
            "getattr": getattr,
            "type": type,
            "repr": repr,
            "None": None,
            "True": True,
            "False": False,
            # Exception types for error handling
            "Exception": Exception,
            "ValueError": ValueError,
            "TypeError": TypeError,
            "KeyError": KeyError,
            "IndexError": IndexError,
            "AttributeError": AttributeError,
            "RuntimeError": RuntimeError,
        }

        namespace = {
            "__builtins__": safe_builtins,
            "asyncio": asyncio,  # Allow async/await
        }

        # Add search_tools function
        namespace["search_tools"] = self._create_search_tools_function()

        # Add tool namespaces organized by server
        tool_namespaces = {}

        logger.debug(f"Building execution namespace from sessions: {list(self.client.sessions.keys())}")

        for server_name, session in self.client.sessions.items():
            # Get tools for this server
            try:
                tools = await session.list_tools()

                # Skip if no tools found
                if not tools:
                    continue

                # Create namespace object for this server
                server_namespace = type(server_name, (), {})()

                for tool in tools:
                    tool_name = tool.name
                    # Sanitize tool name to be a valid Python identifier
                    sanitized_name = re.sub(r"[^a-zA-Z0-9_]", "_", tool_name)
                    if not sanitized_name[0].isalpha() and sanitized_name[0] != "_":
                        sanitized_name = f"_{sanitized_name}"

                    # Create wrapper function for this tool
                    wrapper = self._create_tool_wrapper(server_name, tool_name, tool)
                    setattr(server_namespace, sanitized_name, wrapper)
                    # Also keep original name if it's valid, just in case
                    if sanitized_name != tool_name and tool_name.isidentifier():
                        setattr(server_namespace, tool_name, wrapper)

                tool_namespaces[server_name] = server_namespace
                logger.debug(f"Added namespace '{server_name}' with {len(tools)} tools")

            except Exception as e:
                logger.error(f"Failed to load tools for server {server_name}: {e}")

        # Add all server namespaces to the execution namespace
        namespace.update(tool_namespaces)

        # Add metadata about available namespaces
        namespace["__tool_namespaces"] = list(tool_namespaces.keys())
        logger.debug(f"Final execution namespace keys: {list(namespace.keys())}")

        return namespace

    def _create_tool_wrapper(self, server_name: str, tool_name: str, tool_schema: Any) -> Any:
        """Create a wrapper function for an MCP tool.

        Args:
            server_name: Name of the MCP server.
            tool_name: Name of the tool.
            tool_schema: Tool schema with description and input schema.

        Returns:
            Async function that calls the MCP tool.
        """

        async def tool_wrapper(**kwargs):
            """Dynamically generated tool wrapper."""
            import json

            session = self.client.get_session(server_name)
            result = await session.call_tool(tool_name, kwargs)

            # Extract content from result
            if hasattr(result, "content") and result.content:
                # Return first content item's text if available
                if len(result.content) > 0:
                    content_item = result.content[0]
                    if hasattr(content_item, "text"):
                        text = content_item.text
                        # Try to parse as JSON if possible
                        try:
                            return json.loads(text)
                        except (json.JSONDecodeError, ValueError):
                            # Return as string if not valid JSON
                            return text
                    return content_item
                return result.content

            return result

        # Set function metadata
        tool_wrapper.__name__ = tool_name
        if hasattr(tool_schema, "description"):
            tool_wrapper.__doc__ = tool_schema.description

        return tool_wrapper

    def _create_search_tools_function(self):
        """Create the search_tools function for the execution namespace.

        Returns:
            Function that searches available tools.
        """

        async def search_tools(query: str = "", detail_level: str = "full") -> dict[str, Any]:
            """Search available MCP tools.

            Args:
                query: Search query to filter tools by name or description.
                detail_level: Level of detail to return ("names", "descriptions", "full").

            Returns:
                Dictionary with:
                - meta: Dictionary containing total_tools, namespaces, and result_count
                - results: List of tool information dictionaries matching the query
            """
            all_tools = []
            all_namespaces = set()
            query_lower = query.lower()

            # First pass: collect all tools and namespaces
            for server_name, session in self.client.sessions.items():
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

        return search_tools
