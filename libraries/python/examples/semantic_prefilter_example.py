"""
Example: Using Semantic Pre-filtering with Code Mode

This example demonstrates how to use semantic pre-filtering to reduce large
toolsets before Code Mode operates, improving efficiency and accuracy.
"""

import asyncio

from mcp_use import MCPClient, CodeModeConfig, SemanticPreFilterConfig

# Example configuration with semantic pre-filtering
config = {
    "mcpServers": {
        "filesystem": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
        }
    }
}


async def main():
    """Example: Using semantic pre-filtering with Code Mode."""

    # Option 1: Enable semantic pre-filtering with default settings
    # (uses Qwen3-Embedding and Qwen3-Reranker on DeepInfra)
    client_default = MCPClient(
        config=config,
        code_mode=CodeModeConfig(
            enabled=True,
            semantic_prefilter=SemanticPreFilterConfig(
                enabled=True,
                # Uses DEEPINFRA_API_KEY or OPENAI_API_KEY from environment
            ),
        ),
    )

    # Option 2: Custom semantic pre-filtering configuration
    client_custom = MCPClient(
        config=config,
        code_mode=CodeModeConfig(
            enabled=True,
            semantic_prefilter=SemanticPreFilterConfig(
                enabled=True,
                embeddings_url="https://api.deepinfra.com/v1/inference/Qwen/Qwen3-Embedding-8B-batch",
                reranker_url="https://api.deepinfra.com/v1/inference/Qwen/Qwen3-Reranker-8B",
                embeddings_api_key="your-api-key-here",  # Or set DEEPINFRA_API_KEY env var
                reranker_api_key="your-api-key-here",  # Or set DEEPINFRA_API_KEY env var
                top_k_initial=50,  # Retrieve top 50 tools in initial search
                top_k_final=20,  # Final 20 tools after reranking
                enum_reduction_threshold=10,  # Reduce enums with >10 values
                use_reranking=True,  # Enable reranking
                query="file operations",  # Optional: specific query for filtering
            ),
        ),
    )

    # Option 3: Use OpenAI-compatible embeddings API
    client_openai = MCPClient(
        config=config,
        code_mode=CodeModeConfig(
            enabled=True,
            semantic_prefilter=SemanticPreFilterConfig(
                enabled=True,
                embeddings_url="https://api.openai.com/v1/embeddings",
                embeddings_api_key="your-openai-api-key",  # Or set OPENAI_API_KEY env var
                # Note: OpenAI doesn't provide reranking, so use_reranking will be ignored
                # or you can provide a custom reranker URL
            ),
        ),
    )

    # Create sessions and use Code Mode
    await client_default.create_all_sessions()

    # Execute code - tools will be pre-filtered if there are many
    result = await client_default.execute_code(
        """
# Search for file-related tools
tools = await search_tools("file")
print(f"Found {len(tools['results'])} file-related tools")

# The tools available in the namespace are already pre-filtered
# to the most semantically relevant ones
return tools
"""
    )

    print("Result:", result["result"])
    print("Logs:", result["logs"])


if __name__ == "__main__":
    asyncio.run(main())

