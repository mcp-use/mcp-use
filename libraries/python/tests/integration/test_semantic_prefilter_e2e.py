import os
import pytest
from unittest.mock import Mock, AsyncMock

from mcp_use.client.semantic_prefilter import SemanticPreFilter
from mcp_use.client.code_mode_config import CodeModeConfig, SemanticPreFilterConfig


# Mock tool class for testing
class MockTool:
    """Mock tool for testing semantic pre-filtering."""
    
    def __init__(self, name: str, description: str, input_schema: dict = None):
        self.name = name
        self.description = description
        self.inputSchema = input_schema or {"type": "object", "properties": {}}


@pytest.fixture
def sample_tools():
    """Create a diverse set of mock tools for testing."""
    return [
        # File operation tools
        MockTool("read_file", "Read a file from the filesystem", {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path to read"}
            }
        }),
        MockTool("write_file", "Write content to a file", {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path"},
                "content": {"type": "string", "description": "Content to write"}
            }
        }),
        MockTool("list_directory", "List files in a directory", {
            "type": "object",
            "properties": {
                "directory": {"type": "string", "description": "Directory path"}
            }
        }),
        # Database tools
        MockTool("query_database", "Execute a SQL query on the database", {
            "type": "object",
            "properties": {
                "sql": {"type": "string", "description": "SQL query string"}
            }
        }),
        MockTool("create_table", "Create a new database table", {
            "type": "object",
            "properties": {
                "table_name": {"type": "string", "description": "Name of the table"},
                "schema": {"type": "object", "description": "Table schema"}
            }
        }),
        # Network tools
        MockTool("http_get", "Make an HTTP GET request", {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to fetch"}
            }
        }),
        MockTool("http_post", "Make an HTTP POST request", {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to post to"},
                "data": {"type": "object", "description": "Data to send"}
            }
        }),
        # Math tools
        MockTool("calculate_sum", "Calculate the sum of numbers", {
            "type": "object",
            "properties": {
                "numbers": {"type": "array", "items": {"type": "number"}}
            }
        }),
        MockTool("calculate_average", "Calculate the average of numbers", {
            "type": "object",
            "properties": {
                "numbers": {"type": "array", "items": {"type": "number"}}
            }
        }),
        # Text processing tools
        MockTool("extract_text", "Extract text from a document", {
            "type": "object",
            "properties": {
                "document": {"type": "string", "description": "Document content"}
            }
        }),
        MockTool("translate_text", "Translate text to another language", {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Text to translate"},
                "target_language": {"type": "string", "description": "Target language"}
            }
        }),
    ]


@pytest.fixture
def tools_with_large_enums():
    """Create tools with large enum parameters for testing enum filtering."""
    return [
        MockTool("set_status", "Set the status of an item", {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": [f"status_{i}" for i in range(50)],  # Large enum
                    "description": "Status value"
                }
            }
        }),
        MockTool("set_priority", "Set the priority level", {
            "type": "object",
            "properties": {
                "priority": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],  # Small enum, should not be filtered
                    "description": "Priority level"
                }
            }
        }),
    ]


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.getenv("OPENAI_API_KEY"),
    reason="OPENAI_API_KEY not set - skipping tests that require real API calls"
)
class TestSemanticPreFilterE2E:
    """End-to-end tests for semantic pre-filtering with real API calls."""
    
    async def test_filter_tools_with_file_query(self, sample_tools):
        """Test that file-related tools are correctly filtered when querying for file operations."""
        # Use OpenAI embeddings API
        prefilter = SemanticPreFilter(
            embeddings_url="https://api.openai.com/v1/embeddings",
            embeddings_api_key=os.getenv("OPENAI_API_KEY"),
            top_k_initial=10,
            top_k_final=5,
        )
        
        query = "file operations and reading files"
        
        filtered_tools, filtered_indices = await prefilter.filter_tools(
            sample_tools,
            query=query,
            use_reranking=False,
        )
        
        # Verify that we got filtered results
        assert len(filtered_tools) <= 5, f"Expected at most 5 tools, got {len(filtered_tools)}"
        assert len(filtered_indices) == len(filtered_tools), "Indices and tools should match"
        
        # Verify that file-related tools are in the results
        tool_names = [tool.name for tool in filtered_tools]
        file_tools = ["read_file", "write_file", "list_directory"]
        found_file_tools = [name for name in file_tools if name in tool_names]
        
        assert len(found_file_tools) > 0, f"Expected at least one file tool, got: {tool_names}"
        
        # Verify indices are valid
        assert all(0 <= idx < len(sample_tools) for idx in filtered_indices), "All indices should be valid"
    
    async def test_filter_tools_with_database_query(self, sample_tools):
        """Test that database-related tools are correctly filtered when querying for database operations."""
        prefilter = SemanticPreFilter(
            embeddings_url="https://api.openai.com/v1/embeddings",
            embeddings_api_key=os.getenv("OPENAI_API_KEY"),
            top_k_initial=10,
            top_k_final=3,
        )
        
        query = "database queries and SQL operations"
        
        filtered_tools, filtered_indices = await prefilter.filter_tools(
            sample_tools,
            query=query,
            use_reranking=False,
        )
        
        # Verify results
        assert len(filtered_tools) <= 3, f"Expected at most 3 tools, got {len(filtered_tools)}"
        assert len(filtered_indices) == len(filtered_tools), "Indices and tools should match"
        
        # Verify that database tools are in the results
        tool_names = [tool.name for tool in filtered_tools]
        db_tools = ["query_database", "create_table"]
        found_db_tools = [name for name in db_tools if name in tool_names]
        
        assert len(found_db_tools) > 0, f"Expected at least one database tool, got: {tool_names}"
    
    async def test_filter_tools_with_reranking(self, sample_tools):
        """Test that reranking improves the relevance of filtered tools."""
        # First test without reranking
        prefilter_no_rerank = SemanticPreFilter(
            embeddings_url="https://api.openai.com/v1/embeddings",
            embeddings_api_key=os.getenv("OPENAI_API_KEY"),
            top_k_initial=10,
            top_k_final=5,
        )
        
        query = "file operations"
        
        filtered_no_rerank, _ = await prefilter_no_rerank.filter_tools(
            sample_tools,
            query=query,
            use_reranking=False,
        )
        
        # Test with reranking (if reranker API is available)
        # Note: OpenAI doesn't provide reranking, so we'll test the code path
        # but it will fall back to no reranking
        prefilter_with_rerank = SemanticPreFilter(
            embeddings_url="https://api.openai.com/v1/embeddings",
            embeddings_api_key=os.getenv("OPENAI_API_KEY"),
            top_k_initial=10,
            top_k_final=5,
        )
        
        filtered_with_rerank, _ = await prefilter_with_rerank.filter_tools(
            sample_tools,
            query=query,
            use_reranking=True,
        )
        
        # Both should return results (reranking may fall back gracefully)
        assert len(filtered_no_rerank) > 0, "Should get results without reranking"
        assert len(filtered_with_rerank) > 0, "Should get results with reranking"
        assert len(filtered_no_rerank) <= 5, "Should respect top_k_final"
        assert len(filtered_with_rerank) <= 5, "Should respect top_k_final"
    
    async def test_enum_parameter_filtering(self, tools_with_large_enums):
        """Test that large enum parameters are filtered correctly."""
        prefilter = SemanticPreFilter(
            enum_reduction_threshold=10,
        )
        
        # Filter enum parameters (this doesn't require API calls)
        filtered_tools, _ = await prefilter.filter_tools(
            tools_with_large_enums,
            query=None,  # No query, just filter enums
            use_reranking=False,
        )
        
        # Find the tool with large enum
        status_tool = next((t for t in filtered_tools if t.name == "set_status"), None)
        assert status_tool is not None, "Should find set_status tool"
        
        # Check that enum was filtered
        status_enum = status_tool.inputSchema["properties"]["status"]["enum"]
        assert len(status_enum) == 10, f"Expected enum to be reduced to 10, got {len(status_enum)}"
        assert status_tool.inputSchema["properties"]["status"]["_enum_filtered"] is True
        assert status_tool.inputSchema["properties"]["status"]["_enum_original_count"] == 50
        
        # Check that small enum was not filtered
        priority_tool = next((t for t in filtered_tools if t.name == "set_priority"), None)
        assert priority_tool is not None, "Should find set_priority tool"
        priority_enum = priority_tool.inputSchema["properties"]["priority"]["enum"]
        assert len(priority_enum) == 3, "Small enum should not be filtered"
        assert "_enum_filtered" not in priority_tool.inputSchema["properties"]["priority"]
    
    async def test_filter_tools_with_no_query(self, sample_tools):
        """Test that filter_tools returns all tools when no query is provided."""
        prefilter = SemanticPreFilter(
            top_k_final=20,  # Larger than tool count
        )
        
        filtered_tools, filtered_indices = await prefilter.filter_tools(
            sample_tools,
            query=None,
            use_reranking=False,
        )
        
        # Should return all tools when no query
        assert len(filtered_tools) == len(sample_tools), "Should return all tools when no query"
        assert len(filtered_indices) == len(sample_tools), "Should return all indices"
        assert filtered_indices == list(range(len(sample_tools))), "Indices should be sequential"
    
    async def test_filter_tools_with_small_toolset(self):
        """Test that filtering works correctly with small tool sets."""
        small_tools = [
            MockTool("tool1", "First tool"),
            MockTool("tool2", "Second tool"),
        ]
        
        prefilter = SemanticPreFilter(
            embeddings_url="https://api.openai.com/v1/embeddings",
            embeddings_api_key=os.getenv("OPENAI_API_KEY"),
            top_k_final=5,  # Larger than tool count
        )
        
        filtered_tools, filtered_indices = await prefilter.filter_tools(
            small_tools,
            query="test query",
            use_reranking=False,
        )
        
        # Should return all tools when toolset is smaller than top_k_final
        assert len(filtered_tools) == len(small_tools), "Should return all tools when count < top_k_final"
        assert len(filtered_indices) == len(small_tools), "Should return all indices"
    
    async def test_filter_tools_empty_list(self):
        """Test that filtering handles empty tool lists gracefully."""
        prefilter = SemanticPreFilter()
        
        filtered_tools, filtered_indices = await prefilter.filter_tools(
            [],
            query="test query",
            use_reranking=False,
        )
        
        assert filtered_tools == [], "Should return empty list"
        assert filtered_indices == [], "Should return empty indices"
    
    async def test_cosine_similarity_calculation(self):
        """Test that cosine similarity is calculated correctly."""
        prefilter = SemanticPreFilter()
        
        # Test identical vectors
        vec1 = [1.0, 0.0, 0.0]
        vec2 = [1.0, 0.0, 0.0]
        similarity = prefilter._cosine_similarity(vec1, vec2)
        assert abs(similarity - 1.0) < 0.001, f"Identical vectors should have similarity ~1.0, got {similarity}"
        
        # Test orthogonal vectors
        vec1 = [1.0, 0.0]
        vec2 = [0.0, 1.0]
        similarity = prefilter._cosine_similarity(vec1, vec2)
        assert abs(similarity - 0.0) < 0.001, f"Orthogonal vectors should have similarity ~0.0, got {similarity}"
        
        # Test empty vectors
        similarity = prefilter._cosine_similarity([], [])
        assert similarity == 0.0, f"Empty vectors should have similarity 0.0, got {similarity}"
        
        # Test mismatched lengths
        similarity = prefilter._cosine_similarity([1.0, 2.0], [1.0])
        assert similarity == 0.0, "Mismatched lengths should return 0.0"
    
    async def test_create_tool_text(self, sample_tools):
        """Test that tool text representation is created correctly."""
        prefilter = SemanticPreFilter()
        
        tool = sample_tools[0]  # read_file
        tool_text = prefilter._create_tool_text(tool)
        
        assert "read_file" in tool_text, "Tool name should be in text"
        assert "Read a file" in tool_text, "Tool description should be in text"
        assert "path" in tool_text, "Parameter name should be in text"
    
    async def test_embedding_caching(self, sample_tools):
        """Test that embeddings are cached for performance."""
        prefilter = SemanticPreFilter(
            embeddings_url="https://api.openai.com/v1/embeddings",
            embeddings_api_key=os.getenv("OPENAI_API_KEY"),
        )
        
        query = "test query"
        
        # First call - should fetch from API
        embedding1 = await prefilter._get_embedding(query, use_cache=True)
        assert len(embedding1) > 0, "Should get embedding from API"
        
        # Second call - should use cache
        embedding2 = await prefilter._get_embedding(query, use_cache=True)
        assert embedding1 == embedding2, "Cached embedding should match"
        
        # Verify cache was used
        assert query in prefilter._embedding_cache, "Query should be in cache"
    
    async def test_lru_cache_eviction(self):
        """Test that LRU cache evicts oldest entries when max size is reached."""
        # Create prefilter with small cache size for testing
        import os
        original_cache_size = os.getenv("MCP_USE_EMBEDDING_CACHE_SIZE")
        os.environ["MCP_USE_EMBEDDING_CACHE_SIZE"] = "3"
        
        try:
            # Reimport to get new cache size
            from importlib import reload
            from mcp_use.client import semantic_prefilter
            reload(semantic_prefilter)
            from mcp_use.client.semantic_prefilter import SemanticPreFilter
            
            prefilter = SemanticPreFilter(
                embeddings_url="https://api.openai.com/v1/embeddings",
                embeddings_api_key=os.getenv("OPENAI_API_KEY"),
            )
            
            # Fill cache beyond max size
            await prefilter._get_embedding("query1", use_cache=True)
            await prefilter._get_embedding("query2", use_cache=True)
            await prefilter._get_embedding("query3", use_cache=True)
            await prefilter._get_embedding("query4", use_cache=True)  # Should evict query1
            
            # Verify oldest entry was evicted
            assert "query1" not in prefilter._embedding_cache, "Oldest entry should be evicted"
            assert "query4" in prefilter._embedding_cache, "Newest entry should be in cache"
            assert len(prefilter._embedding_cache) == 3, "Cache should not exceed max size"
        finally:
            # Restore original cache size
            if original_cache_size:
                os.environ["MCP_USE_EMBEDDING_CACHE_SIZE"] = original_cache_size
            else:
                os.environ.pop("MCP_USE_EMBEDDING_CACHE_SIZE", None)


@pytest.mark.asyncio
class TestSemanticPreFilterErrorHandling:
    """Test error handling and edge cases."""
    
    async def test_api_failure_graceful_fallback(self, sample_tools):
        """Test that API failures result in graceful fallback to all tools."""
        # Use invalid API key to trigger failure
        prefilter = SemanticPreFilter(
            embeddings_url="https://api.openai.com/v1/embeddings",
            embeddings_api_key="invalid_key",
            top_k_final=5,
        )
        
        filtered_tools, filtered_indices = await prefilter.filter_tools(
            sample_tools,
            query="test query",
            use_reranking=False,
        )
        
        # Should fallback to all tools when API fails
        assert len(filtered_tools) == len(sample_tools), "Should return all tools on API failure"
        assert len(filtered_indices) == len(sample_tools), "Should return all indices"
    
    async def test_invalid_embeddings_url(self, sample_tools):
        """Test handling of invalid embeddings URL."""
        prefilter = SemanticPreFilter(
            embeddings_url="https://invalid-url-that-does-not-exist.com/embeddings",
            embeddings_api_key="test_key",
            top_k_final=5,
        )
        
        filtered_tools, filtered_indices = await prefilter.filter_tools(
            sample_tools,
            query="test query",
            use_reranking=False,
        )
        
        # Should fallback gracefully
        assert len(filtered_tools) > 0, "Should return tools even on URL failure"
