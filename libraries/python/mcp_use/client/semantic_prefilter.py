"""
Semantic pre-filtering for Code Mode.

This module provides semantic search and reranking capabilities to pre-filter
large toolsets before they're made available to Code Mode, reducing LLM token
usage and improving accuracy by avoiding Context Rot.
"""

import json
import math
import os
from typing import Any

import httpx

from mcp_use.logging import logger

# typing_extensions is not needed for this module


class SemanticPreFilter:
    """
    Semantic pre-filtering engine for tools and enum parameters.
    
    Uses embedding-based semantic search with optional reranking to reduce
    large toolsets to semantically relevant subsets before Code Mode operates.
    """

    def __init__(
        self,
        embeddings_url: str | None = None,
        reranker_url: str | None = None,
        embeddings_api_key: str | None = None,
        reranker_api_key: str | None = None,
        top_k_initial: int = 50,
        top_k_final: int = 20,
        enum_reduction_threshold: int = 10,
    ):
        """
        Initialize the semantic pre-filter.

        Args:
            embeddings_url: URL for embeddings API (defaults to Qwen3-Embedding on DeepInfra)
            reranker_url: URL for reranker API (defaults to Qwen3-Reranker on DeepInfra)
            embeddings_api_key: API key for embeddings service (uses DEEPINFRA_API_KEY if not provided)
            reranker_api_key: API key for reranker service (uses DEEPINFRA_API_KEY if not provided)
            top_k_initial: Number of tools to retrieve in initial semantic search
            top_k_final: Final number of tools after reranking
            enum_reduction_threshold: Minimum enum size to trigger reduction
        """
        # Default to Qwen3 models on DeepInfra
        self.embeddings_url = embeddings_url or os.getenv(
            "EMBEDDINGS_URL",
            "https://api.deepinfra.com/v1/inference/Qwen/Qwen3-Embedding-8B-batch",
        )
        self.reranker_url = reranker_url or os.getenv(
            "RERANKER_URL",
            "https://api.deepinfra.com/v1/inference/Qwen/Qwen3-Reranker-8B",
        )

        # API keys
        self.embeddings_api_key = embeddings_api_key or os.getenv(
            "DEEPINFRA_API_KEY", os.getenv("OPENAI_API_KEY", "")
        )
        self.reranker_api_key = reranker_api_key or os.getenv(
            "DEEPINFRA_API_KEY", os.getenv("OPENAI_API_KEY", "")
        )

        self.top_k_initial = top_k_initial
        self.top_k_final = top_k_final
        self.enum_reduction_threshold = enum_reduction_threshold

        # Cache for embeddings
        self._embedding_cache: dict[str, list[float]] = {}
        self._tool_embeddings: dict[str, list[float]] = {}

    async def _get_embedding(self, text: str, use_cache: bool = True) -> list[float]:
        """
        Get embedding for text using the embeddings API.

        Args:
            text: Text to embed
            use_cache: Whether to use cached embeddings

        Returns:
            Embedding vector
        """
        if use_cache and text in self._embedding_cache:
            return self._embedding_cache[text]

        try:
            # Check if it's OpenAI-compatible API
            if "openai" in self.embeddings_url.lower() or "api.openai.com" in self.embeddings_url:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(
                        self.embeddings_url.replace("/inference/", "/embeddings") if "/inference/" in self.embeddings_url else self.embeddings_url,
                        headers={
                            "Authorization": f"Bearer {self.embeddings_api_key}",
                            "Content-Type": "application/json",
                        },
                        json={"input": text, "model": "text-embedding-3-small"},
                    )
                    response.raise_for_status()
                    data = response.json()
                    embedding = data["data"][0]["embedding"]
            else:
                # DeepInfra or other inference API
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(
                        self.embeddings_url,
                        headers={
                            "Authorization": f"Bearer {self.embeddings_api_key}",
                            "Content-Type": "application/json",
                        },
                        json={"inputs": text},
                    )
                    response.raise_for_status()
                    data = response.json()
                    # Handle different response formats
                    if isinstance(data, list):
                        embedding = data[0] if data else []
                    elif isinstance(data, dict):
                        embedding = data.get("embeddings", data.get("data", [[]]))[0]
                    else:
                        embedding = []

            if use_cache:
                self._embedding_cache[text] = embedding

            return embedding

        except Exception as e:
            logger.warning(f"Failed to get embedding: {e}. Falling back to empty embedding.")
            return []

    async def _get_embeddings_batch(self, texts: list[str]) -> list[list[float]]:
        """
        Get embeddings for multiple texts in batch.

        Args:
            texts: List of texts to embed

        Returns:
            List of embedding vectors
        """
        try:
            # Check if it's OpenAI-compatible API
            if "openai" in self.embeddings_url.lower() or "api.openai.com" in self.embeddings_url:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    response = await client.post(
                        self.embeddings_url.replace("/inference/", "/embeddings") if "/inference/" in self.embeddings_url else self.embeddings_url,
                        headers={
                            "Authorization": f"Bearer {self.embeddings_api_key}",
                            "Content-Type": "application/json",
                        },
                        json={"input": texts, "model": "text-embedding-3-small"},
                    )
                    response.raise_for_status()
                    data = response.json()
                    embeddings = [item["embedding"] for item in data["data"]]
            else:
                # DeepInfra or other inference API
                async with httpx.AsyncClient(timeout=60.0) as client:
                    response = await client.post(
                        self.embeddings_url,
                        headers={
                            "Authorization": f"Bearer {self.embeddings_api_key}",
                            "Content-Type": "application/json",
                        },
                        json={"inputs": texts},
                    )
                    response.raise_for_status()
                    data = response.json()
                    # Handle different response formats
                    if isinstance(data, list):
                        embeddings = data
                    elif isinstance(data, dict):
                        embeddings = data.get("embeddings", data.get("data", []))
                    else:
                        embeddings = []

            return embeddings

        except Exception as e:
            logger.warning(f"Failed to get batch embeddings: {e}. Falling back to individual requests.")
            # Fallback to individual requests
            return [await self._get_embedding(text) for text in texts]

    async def _rerank(
        self, query: str, texts: list[str], scores: list[float] | None = None
    ) -> list[tuple[int, float]]:
        """
        Rerank texts using the reranker API.

        Args:
            query: Search query
            texts: List of texts to rerank
            scores: Optional initial scores for each text

        Returns:
            List of (index, score) tuples sorted by relevance
        """
        if not texts:
            return []

        try:
            # Prepare pairs for reranking
            pairs = [[query, text] for text in texts]

            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    self.reranker_url,
                    headers={
                        "Authorization": f"Bearer {self.reranker_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={"inputs": pairs},
                )
                response.raise_for_status()
                data = response.json()

                # Handle different response formats
                if isinstance(data, list):
                    rerank_scores = data
                elif isinstance(data, dict):
                    rerank_scores = data.get("scores", data.get("data", []))
                else:
                    rerank_scores = []

                # Combine with initial scores if provided
                if scores and len(scores) == len(rerank_scores):
                    combined_scores = [
                        (rerank_scores[i] + scores[i]) / 2 for i in range(len(rerank_scores))
                    ]
                else:
                    combined_scores = rerank_scores

                # Return sorted indices with scores
                indexed_scores = list(enumerate(combined_scores))
                indexed_scores.sort(key=lambda x: x[1], reverse=True)
                return indexed_scores

        except Exception as e:
            logger.warning(f"Failed to rerank: {e}. Using initial scores.")
            # Fallback to initial scores or equal scores
            if scores:
                indexed_scores = list(enumerate(scores))
                indexed_scores.sort(key=lambda x: x[1], reverse=True)
                return indexed_scores
            return [(i, 1.0) for i in range(len(texts))]

    def _cosine_similarity(self, vec1: list[float], vec2: list[float]) -> float:
        """
        Calculate cosine similarity between two vectors.

        Args:
            vec1: First vector
            vec2: Second vector

        Returns:
            Cosine similarity score
        """
        if not vec1 or not vec2 or len(vec1) != len(vec2):
            return 0.0

        dot_product = sum(a * b for a, b in zip(vec1, vec2, strict=False))
        magnitude1 = math.sqrt(sum(a * a for a in vec1))
        magnitude2 = math.sqrt(sum(b * b for b in vec2))

        if magnitude1 == 0 or magnitude2 == 0:
            return 0.0

        return dot_product / (magnitude1 * magnitude2)

    def _create_tool_text(self, tool: Any) -> str:
        """
        Create searchable text representation of a tool.

        Args:
            tool: Tool object with name, description, and inputSchema

        Returns:
            Searchable text string
        """
        name = getattr(tool, "name", "")
        description = getattr(tool, "description", "")
        input_schema = getattr(tool, "inputSchema", {})

        # Include parameter names and descriptions
        param_texts = []
        if isinstance(input_schema, dict):
            properties = input_schema.get("properties", {})
            for param_name, param_schema in properties.items():
                param_desc = param_schema.get("description", "")
                param_type = param_schema.get("type", "")
                param_texts.append(f"{param_name} ({param_type}): {param_desc}")

        return f"{name} {description} {' '.join(param_texts)}"

    async def filter_tools(
        self,
        tools: list[Any],
        query: str | None = None,
        use_reranking: bool = True,
    ) -> tuple[list[Any], list[int]]:
        """
        Filter tools using semantic search and optional reranking.

        Args:
            tools: List of tool objects to filter
            query: Optional query string for semantic search (if None, returns all tools)
            use_reranking: Whether to use reranking after semantic search

        Returns:
            Tuple of (filtered list of tools, list of original indices)
        """
        if not tools:
            return [], []

        # If no query provided or tools count is small, return all tools
        if not query or len(tools) <= self.top_k_final:
            # Still filter enum parameters, return all indices
            filtered_tools = [self._filter_enum_parameters(tool) for tool in tools]
            return filtered_tools, list(range(len(tools)))

        logger.info(f"Pre-filtering {len(tools)} tools with query: {query}")

        # Create tool texts for embedding
        tool_texts = [self._create_tool_text(tool) for tool in tools]

        # Get embeddings for query and tools
        query_embedding = await self._get_embedding(query)
        if not query_embedding:
            logger.warning("Failed to get query embedding, returning all tools")
            filtered_tools = [self._filter_enum_parameters(tool) for tool in tools]
            return filtered_tools, list(range(len(tools)))

        # Get embeddings for all tools in batch
        tool_embeddings = await self._get_embeddings_batch(tool_texts)
        if not tool_embeddings or len(tool_embeddings) != len(tools):
            logger.warning("Failed to get tool embeddings, returning all tools")
            filtered_tools = [self._filter_enum_parameters(tool) for tool in tools]
            return filtered_tools, list(range(len(tools)))

        # Calculate similarity scores
        scores = [
            self._cosine_similarity(query_embedding, tool_emb) for tool_emb in tool_embeddings
        ]

        # Get top K initial results
        indexed_scores = list(enumerate(scores))
        indexed_scores.sort(key=lambda x: x[1], reverse=True)
        top_k_indices = [idx for idx, _ in indexed_scores[: self.top_k_initial]]
        top_k_tools = [tools[idx] for idx in top_k_indices]
        top_k_texts = [tool_texts[idx] for idx in top_k_indices]
        top_k_scores = [scores[idx] for idx in top_k_indices]

        # Rerank if enabled
        if use_reranking and len(top_k_tools) > self.top_k_final:
            logger.info(f"Reranking {len(top_k_tools)} tools to {self.top_k_final}")
            reranked = await self._rerank(query, top_k_texts, top_k_scores)
            # Ensure reranked indices are valid
            reranked_indices = [idx for idx, _ in reranked[: self.top_k_final] if 0 <= idx < len(top_k_indices)]
            final_indices = [top_k_indices[idx] for idx in reranked_indices]
            # Validate final_indices are within bounds
            final_indices = [idx for idx in final_indices if 0 <= idx < len(tools)]
            filtered_tools = [tools[idx] for idx in final_indices]
        else:
            final_indices = top_k_indices[: self.top_k_final]
            # Validate indices are within bounds
            final_indices = [idx for idx in final_indices if 0 <= idx < len(tools)]
            filtered_tools = [tools[idx] for idx in final_indices]

        # Ensure filtered_tools and final_indices have matching lengths
        if len(filtered_tools) != len(final_indices):
            logger.error(
                f"Length mismatch after filtering: {len(filtered_tools)} tools but "
                f"{len(final_indices)} indices. Truncating to match."
            )
            min_length = min(len(filtered_tools), len(final_indices))
            filtered_tools = filtered_tools[:min_length]
            final_indices = final_indices[:min_length]

        logger.info(f"Filtered {len(tools)} tools down to {len(filtered_tools)}")

        # Filter enum parameters in the final tools
        filtered_tools_with_enums = [self._filter_enum_parameters(tool) for tool in filtered_tools]
        return filtered_tools_with_enums, final_indices

    def _filter_enum_parameters(self, tool: Any) -> Any:
        """
        Filter large enum parameters within a tool's input schema.

        Args:
            tool: Tool object to filter

        Returns:
            Tool object with filtered enum parameters (may be a wrapper if original is immutable)
        """
        input_schema = getattr(tool, "inputSchema", {})
        if not isinstance(input_schema, dict):
            return tool

        # Deep copy the schema
        filtered_schema = json.loads(json.dumps(input_schema))

        # Recursively filter enum parameters
        self._filter_schema_enums(filtered_schema)

        # Check if schema was actually modified
        original_str = json.dumps(input_schema, sort_keys=True)
        filtered_str = json.dumps(filtered_schema, sort_keys=True)
        if original_str == filtered_str:
            # No changes, return original tool
            return tool

        # Create a wrapper tool with filtered schema
        # This preserves the original tool but uses filtered schema
        class FilteredTool:
            """Wrapper for tool with filtered enum parameters."""

            def __init__(self, original_tool, filtered_schema):
                self.name = original_tool.name
                self.description = getattr(original_tool, "description", "")
                self.inputSchema = filtered_schema
                # Store reference to original tool for server mapping
                self._original_tool = original_tool
                # Preserve other attributes
                for attr in dir(original_tool):
                    if not attr.startswith("_") and attr not in ["name", "description", "inputSchema"]:
                        try:
                            setattr(self, attr, getattr(original_tool, attr))
                        except (AttributeError, TypeError):
                            pass

        return FilteredTool(tool, filtered_schema)

    def _filter_schema_enums(self, schema: dict[str, Any]) -> None:
        """
        Recursively filter large enum values in a JSON schema.

        Args:
            schema: JSON schema dictionary to filter in-place
        """
        if not isinstance(schema, dict):
            return

        # Filter enum in current level
        if "enum" in schema and isinstance(schema["enum"], list):
            enum_values = schema["enum"]
            if len(enum_values) > self.enum_reduction_threshold:
                # Keep only the first N values (could be improved with semantic filtering)
                schema["enum"] = enum_values[: self.enum_reduction_threshold]
                schema["_enum_filtered"] = True
                schema["_enum_original_count"] = len(enum_values)
                logger.debug(
                    f"Filtered enum from {len(enum_values)} to {self.enum_reduction_threshold} values"
                )

        # Recursively filter in properties
        if "properties" in schema and isinstance(schema["properties"], dict):
            for prop_schema in schema["properties"].values():
                self._filter_schema_enums(prop_schema)

        # Recursively filter in items (for arrays)
        if "items" in schema:
            self._filter_schema_enums(schema["items"])

        # Recursively filter in anyOf, oneOf, allOf
        for key in ["anyOf", "oneOf", "allOf"]:
            if key in schema and isinstance(schema[key], list):
                for sub_schema in schema[key]:
                    self._filter_schema_enums(sub_schema)

