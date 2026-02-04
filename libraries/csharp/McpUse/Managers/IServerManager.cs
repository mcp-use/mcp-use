using Microsoft.Extensions.AI;

namespace McpUse.Managers;

/// <summary>
/// Interface for server managers that can dynamically select and manage MCP servers.
/// Allows an agent to discover, connect to, and switch between multiple MCP servers.
/// </summary>
public interface IServerManager
{
    /// <summary>
    /// Gets the currently active server name.
    /// </summary>
    string? ActiveServer { get; }

    /// <summary>
    /// Gets all available server names.
    /// </summary>
    IReadOnlyList<string> GetServerNames();

    /// <summary>
    /// Gets whether a server has been initialized.
    /// </summary>
    IReadOnlyDictionary<string, bool> InitializedServers { get; }

    /// <summary>
    /// Initialize the server manager.
    /// </summary>
    Task InitializeAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets all available AI functions including management tools and active server tools.
    /// </summary>
    Task<IList<AIFunction>> GetAllFunctionsAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Gets management tools for server discovery and connection.
    /// </summary>
    IList<AIFunction> GetManagementFunctions();

    /// <summary>
    /// Gets tools from the currently active server.
    /// </summary>
    Task<IList<AIFunction>> GetActiveServerFunctionsAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Checks if available tools have changed.
    /// </summary>
    bool HasToolChanges(ISet<string> currentToolNames);

    /// <summary>
    /// Connect to a specific server.
    /// </summary>
    Task<string> ConnectToServerAsync(string serverName, CancellationToken cancellationToken = default);

    /// <summary>
    /// Disconnect from the active server.
    /// </summary>
    Task<string> DisconnectFromServerAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Search for tools across all servers.
    /// </summary>
    Task<IList<ToolSearchResult>> SearchToolsAsync(string query, int topK = 100, CancellationToken cancellationToken = default);
}

/// <summary>
/// Result from a tool search operation.
/// </summary>
public record ToolSearchResult(
    string ServerName,
    string ToolName,
    string Description,
    double Score
);
