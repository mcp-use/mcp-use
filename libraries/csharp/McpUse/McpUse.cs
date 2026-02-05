// Re-export main types at root namespace for convenience
// This allows: using McpUse; var client = new McpUseClient(...);

using McpUse.Agent;
using McpUse.Agent.Prompts;
using McpUse.Client;
using McpUse.Configuration;

// Type aliases for cleaner API at root namespace
namespace McpUse;

/// <summary>
/// Alias for McpUseClient - the main entry point for MCP connections.
/// </summary>
public static class MCPClient
{
    /// <summary>
    /// Create a client from a configuration file.
    /// </summary>
    public static McpUseClient FromConfigFile(string filePath)
        => McpUseClient.FromConfigFile(filePath);

    /// <summary>
    /// Create a client from a JSON string.
    /// </summary>
    public static McpUseClient FromJson(string json)
        => McpUseClient.FromJson(json);

    /// <summary>
    /// Create a client from a dictionary.
    /// </summary>
    public static McpUseClient FromDictionary(Dictionary<string, object> config)
        => McpUseClient.FromDictionary(config);
}

/// <summary>
/// Alias for McpAgent - high-level AI agent.
/// </summary>
public static class MCPAgent
{
    /// <summary>
    /// Create a new agent with the specified chat client and MCP client.
    /// </summary>
    public static McpAgent Create(
        Microsoft.Extensions.AI.IChatClient chatClient,
        McpUseClient mcpClient,
        McpAgentOptions? options = null)
        => new McpAgent(chatClient, mcpClient, options);
}
