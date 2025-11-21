"""
Code execution engine for MCP tools.

This module provides secure code execution capabilities for MCP clients,
allowing agents to interact with tools through Python code instead of
direct tool calls.
"""

import asyncio
import io
import math
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
        # Semantic search state
        self._embedding_model = None
        self._embedding_function = None
        self._tool_embeddings: dict[tuple[str, str], list[float]] = {}
        self._tools_by_key: dict[tuple[str, str], Any] = {}  # Maps (server, tool_name) to tool
        self._tool_texts: dict[tuple[str, str], str] = {}  # Maps (server, tool_name) to searchable text
        self._is_indexed = False

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

    def _load_embedding_model(self) -> bool:
        """Load the embedding model for semantic search if not already loaded.

        Returns:
            True if model loaded successfully, False otherwise.
        """
        if self._embedding_function is not None:
            return True

        try:
            from fastembed import TextEmbedding  # optional dependency install with [search]
        except ImportError:
            logger.debug(
                "The 'fastembed' library is not installed. "
                "Falling back to naive search. To use semantic search, install: pip install mcp-use[search]"
            )
            return False

        try:
            self._embedding_model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")
            self._embedding_function = lambda texts: list(self._embedding_model.embed(texts))
            return True
        except Exception as e:
            logger.warning(f"Failed to load embedding model: {e}. Falling back to naive search.")
            return False

    async def _index_tools_for_search(self) -> None:
        """Index all tools from all sessions for semantic search."""
        if not self._load_embedding_model():
            return

        # Clear previous index
        self._tool_embeddings = {}
        self._tools_by_key = {}
        self._tool_texts = {}
        self._is_indexed = False

        # Collect all tools and their descriptions
        tool_keys = []
        tool_texts_list = []

        for server_name, session in self.client.sessions.items():
            try:
                tools = await session.list_tools()
                for tool in tools:
                    tool_key = (server_name, tool.name)
                    # Create text representation for search
                    tool_description = getattr(tool, "description", "") or ""
                    tool_text = f"{tool.name}: {tool_description}".lower()

                    self._tools_by_key[tool_key] = tool
                    self._tool_texts[tool_key] = tool_text
                    tool_keys.append(tool_key)
                    tool_texts_list.append(tool_text)

            except Exception as e:
                logger.error(f"Failed to index tools for server {server_name}: {e}")

        if not tool_texts_list:
            return

        # Generate embeddings
        try:
            embeddings = self._embedding_function(tool_texts_list)
            for tool_key, embedding in zip(tool_keys, embeddings, strict=True):
                self._tool_embeddings[tool_key] = embedding

            self._is_indexed = len(self._tool_embeddings) > 0
            logger.debug(f"Indexed {len(self._tool_embeddings)} tools for semantic search")
        except Exception as e:
            logger.warning(f"Failed to generate embeddings: {e}. Falling back to naive search.")
            self._is_indexed = False

    def _cosine_similarity(self, vec1: list[float], vec2: list[float]) -> float:
        """Calculate cosine similarity between two vectors.

        Args:
            vec1: First vector
            vec2: Second vector

        Returns:
            Cosine similarity between the vectors
        """
        # Calculate dot product
        dot_product = sum(a * b for a, b in zip(vec1, vec2, strict=False))

        # Calculate magnitudes
        magnitude1 = math.sqrt(sum(a * a for a in vec1))
        magnitude2 = math.sqrt(sum(b * b for b in vec2))

        # Avoid division by zero
        if magnitude1 == 0 or magnitude2 == 0:
            return 0.0

        # Calculate cosine similarity
        return dot_product / (magnitude1 * magnitude2)

    def _semantic_search(self, query: str, top_k: int = 100) -> list[tuple[tuple[str, str], float]]:
        """Perform semantic search on indexed tools.

        Args:
            query: The search query
            top_k: Number of top results to return

        Returns:
            List of tuples containing ((server_name, tool_name), score)
        """
        if not self._is_indexed or not self._embedding_function:
            return []

        # Generate embedding for the query
        try:
            query_embedding = self._embedding_function([query])[0]
        except Exception:
            return []

        # Calculate similarity scores
        scores = {}
        for tool_key, embedding in self._tool_embeddings.items():
            similarity = self._cosine_similarity(query_embedding, embedding)
            scores[tool_key] = float(similarity)

        # Sort by score and get top_k results
        sorted_results = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:top_k]
        return sorted_results

    async def _naive_search(self, query: str) -> list[tuple[str, Any]]:
        """Perform naive substring search on tools.

        Args:
            query: The search query

        Returns:
            List of tuples containing (server_name, tool)
        """
        query_lower = query.lower()
        results = []

        for server_name, session in self.client.sessions.items():
            try:
                tools = await session.list_tools()
                for tool in tools:
                    tool_name_match = query_lower in tool.name.lower()
                    desc_match = hasattr(tool, "description") and query_lower in tool.description.lower()

                    if tool_name_match or desc_match:
                        results.append((server_name, tool))
            except Exception as e:
                logger.error(f"Failed to list tools for server {server_name}: {e}")

        return results

    def _create_search_tools_function(self):
        """Create the search_tools function for the execution namespace.

        Returns:
            Function that searches available tools using semantic search.
        """

        async def search_tools(query: str = "", detail_level: str = "full") -> list[dict[str, Any]]:
            """Search available MCP tools using semantic search.

            Args:
                query: Search query to find relevant tools semantically.
                detail_level: Level of detail to return ("names", "descriptions", "full").

            Returns:
                List of tool information dictionaries, sorted by relevance.
            """
            # Ensure tools are indexed for semantic search
            if not self._is_indexed:
                await self._index_tools_for_search()

            all_tools = []

            if query:
                # Try semantic search first if available
                if self._is_indexed:
                    semantic_results = self._semantic_search(query, top_k=100)
                    for (server_name, tool_name), score in semantic_results:
                        tool = self._tools_by_key.get((server_name, tool_name))
                        if tool:
                            # Build tool info based on detail level
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
                else:
                    # Fallback to naive search if embeddings not available
                    naive_results = await self._naive_search(query)
                    for server_name, tool in naive_results:
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
            else:
                # No query - return all tools
                for server_name, session in self.client.sessions.items():
                    try:
                        tools = await session.list_tools()
                        for tool in tools:
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

            return all_tools

        return search_tools
