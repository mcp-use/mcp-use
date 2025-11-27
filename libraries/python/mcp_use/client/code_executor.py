"""
Code execution engine for MCP tools.

This module provides secure code execution capabilities for MCP clients,
allowing agents to interact with tools through Python code instead of
direct tool calls.
"""

import asyncio
import io
import os
import re
import time
from contextlib import redirect_stderr, redirect_stdout
from typing import TYPE_CHECKING, Any

from mcp_use.logging import logger

if TYPE_CHECKING:
    from mcp_use.client.client import MCPClient, SemanticSearchConfig


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
        self._semantic_config: SemanticSearchConfig | None = getattr(
            client, "_semantic_config", None
        )
        self._tool_embeddings_cache: dict[str, list[float]] = {}

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

            # Filter by query using the configured search mode
            filtered_tools = all_tools
            if query:
                search_mode = (
                    self._semantic_config.mode
                    if self._semantic_config
                    else "string_match"
                )
                
                if search_mode == "fuzzy":
                    filtered_tools = await self._fuzzy_search(all_tools, query)
                elif search_mode == "embeddings":
                    filtered_tools = await self._embeddings_search(all_tools, query)
                else:
                    # string_match (default)
                    filtered_tools = self._string_match_search(all_tools, query)

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

    def _string_match_search(
        self, tools: list[dict[str, Any]], query: str
    ) -> list[dict[str, Any]]:
        """String match search (default, naive search)."""
        query_lower = query.lower()
        filtered = []
        for tool_info in tools:
            tool_name_match = query_lower in tool_info["name"].lower()
            desc_match = query_lower in tool_info.get("description", "").lower()
            server_match = query_lower in tool_info["server"].lower()
            if tool_name_match or desc_match or server_match:
                filtered.append(tool_info)
        return filtered

    async def _fuzzy_search(
        self, tools: list[dict[str, Any]], query: str
    ) -> list[dict[str, Any]]:
        """Fuzzy search using fuse.js (via thefuzz library)."""
        try:
            from thefuzz import fuzz, process
        except ImportError:
            raise ImportError(
                "thefuzz is required for fuzzy search mode. Install it with: pip install thefuzz[speedup]"
            )

        # Use thefuzz to find best matches
        tool_strings = [
            f"{tool['name']} {tool.get('description', '')} {tool['server']}"
            for tool in tools
        ]
        results = process.extract(
            query, tool_strings, limit=len(tools), scorer=fuzz.token_sort_ratio
        )

        # Filter by threshold (similarity > 40%)
        filtered = []
        for tool, score, _ in results:
            if score > 40:
                # Find the tool that matches this string
                tool_index = tool_strings.index(tool)
                filtered.append(tools[tool_index])

        return filtered

    async def _embeddings_search(
        self, tools: list[dict[str, Any]], query: str
    ) -> list[dict[str, Any]]:
        """Embeddings-based semantic search."""
        # Check for OpenAI or Anthropic API keys
        openai_api_key = os.getenv("OPENAI_API_KEY")
        anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
        embeddings_url = (
            self._semantic_config.embeddings_url if self._semantic_config else None
        )

        if not openai_api_key and not anthropic_api_key and not embeddings_url:
            raise ValueError(
                "Embeddings search mode requires either:\n"
                "  - OPENAI_API_KEY environment variable, or\n"
                "  - ANTHROPIC_API_KEY environment variable, or\n"
                "  - embeddings_url in semantic config"
            )

        # Get query embedding
        if openai_api_key:
            query_embedding = await self._get_openai_embedding(query, openai_api_key)
        elif embeddings_url:
            query_embedding = await self._get_custom_embedding(query, embeddings_url)
        else:
            # Anthropic doesn't have direct embeddings API
            raise ValueError(
                "Anthropic API doesn't provide direct embeddings. "
                "Please use embeddings_url in semantic config with an OpenAI-compatible embeddings API."
            )

        # Get or compute tool embeddings
        tool_embeddings = await self._get_tool_embeddings(
            tools, openai_api_key, embeddings_url
        )

        # Calculate cosine similarity and sort
        scored_tools = []
        for tool, tool_embedding in zip(tools, tool_embeddings):
            similarity = self._cosine_similarity(query_embedding, tool_embedding)
            scored_tools.append((tool, similarity))

        # Sort by similarity (highest first)
        scored_tools.sort(key=lambda x: x[1], reverse=True)

        # Return tools with similarity > 0.3 (threshold)
        return [tool for tool, similarity in scored_tools if similarity > 0.3]

    async def _get_openai_embedding(
        self, text: str, api_key: str
    ) -> list[float]:
        """Get OpenAI embedding."""
        try:
            import httpx

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {api_key}",
                    },
                    json={"model": "text-embedding-3-small", "input": text},
                    timeout=30.0,
                )
                response.raise_for_status()
                data = response.json()
                return data["data"][0]["embedding"]
        except Exception as e:
            raise RuntimeError(f"Failed to get OpenAI embedding: {e}") from e

    async def _get_custom_embedding(
        self, text: str, url: str
    ) -> list[float]:
        """Get embedding from custom OpenAI-compatible API."""
        try:
            import httpx

            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url,
                    headers={"Content-Type": "application/json"},
                    json={"model": "text-embedding-3-small", "input": text},
                    timeout=30.0,
                )
                response.raise_for_status()
                data = response.json()
                # Support both OpenAI format and direct array format
                if "data" in data and isinstance(data["data"], list) and data["data"]:
                    return data["data"][0].get("embedding", data["data"][0])
                elif "embedding" in data:
                    return data["embedding"]
                elif isinstance(data, list):
                    return data
                raise ValueError("Unexpected embeddings API response format")
        except Exception as e:
            raise RuntimeError(f"Failed to get custom embedding: {e}") from e

    async def _get_tool_embeddings(
        self,
        tools: list[dict[str, Any]],
        openai_api_key: str | None,
        embeddings_url: str | None,
    ) -> list[list[float]]:
        """Get embeddings for all tools (with caching)."""
        embeddings = []

        for tool in tools:
            # Create cache key from tool name and description
            cache_key = f"{tool['name']}:{tool.get('description', '')}"

            if cache_key in self._tool_embeddings_cache:
                embeddings.append(self._tool_embeddings_cache[cache_key])
                continue

            # Create text representation for embedding
            tool_text = f"{tool['name']} {tool.get('description', '')} {tool['server']}".strip()

            if openai_api_key:
                embedding = await self._get_openai_embedding(tool_text, openai_api_key)
            elif embeddings_url:
                embedding = await self._get_custom_embedding(tool_text, embeddings_url)
            else:
                raise ValueError("No embedding provider available")

            self._tool_embeddings_cache[cache_key] = embedding
            embeddings.append(embedding)

        return embeddings

    def _cosine_similarity(self, a: list[float], b: list[float]) -> float:
        """Calculate cosine similarity between two vectors."""
        if len(a) != len(b):
            raise ValueError("Vectors must have the same length")

        dot_product = sum(x * y for x, y in zip(a, b))
        norm_a = sum(x * x for x in a) ** 0.5
        norm_b = sum(x * x for x in b) ** 0.5

        if norm_a == 0 or norm_b == 0:
            return 0.0

        return dot_product / (norm_a * norm_b)
