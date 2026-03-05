"""
Example: Using Semantic Pre-filtering with Code Mode

This example demonstrates how to use semantic pre-filtering to reduce large
toolsets before Code Mode operates, improving efficiency and accuracy.
"""

import asyncio

from mcp_use import CodeModeConfig, MCPClient, SemanticPreFilterConfig

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

    # Option 2: Custom semantic pre-filtering (example config only)
    # client_custom = MCPClient(
    #     config=config,
    #     code_mode=CodeModeConfig(
    #         enabled=True,
    #         semantic_prefilter=SemanticPreFilterConfig(
    #             enabled=True,
    #             embeddings_url="https://api.deepinfra.com/v1/inference/Qwen/Qwen3-Embedding-8B-batch",
    #             reranker_url="https://api.deepinfra.com/v1/inference/Qwen/Qwen3-Reranker-8B",
    #             top_k_initial=50,
    #             top_k_final=20,
    #             enum_reduction_threshold=10,
    #             use_reranking=True,
    #             query="file operations",
    #         ),
    #     ),
    # )

    # Option 3: OpenAI-compatible embeddings (example config only)
    # client_openai = MCPClient(
    #     config=config,
    #     code_mode=CodeModeConfig(
    #         enabled=True,
    #         semantic_prefilter=SemanticPreFilterConfig(
    #             enabled=True,
    #             embeddings_url="https://api.openai.com/v1/embeddings",
    #             embeddings_api_key="your-openai-api-key",
    #         ),
    #     ),
    # )

    # Create sessions and use Code Mode
    await client_default.create_all_sessions()
    try:
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
    finally:
        await client_default.close_all_sessions()


if __name__ == "__main__":
    asyncio.run(main())
