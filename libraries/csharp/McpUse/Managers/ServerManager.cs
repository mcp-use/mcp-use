using System.ComponentModel;
using System.Text.Json;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using McpUse.Client;

namespace McpUse.Managers;

/// <summary>
/// Manages MCP servers and provides tools for server selection and management.
/// This class allows an agent to discover and select which MCP server to use,
/// dynamically activating the tools for the selected server.
/// </summary>
public class ServerManager : IServerManager
{
    private readonly McpUseClient _client;
    private readonly ILogger<ServerManager>? _logger;
    private readonly Dictionary<string, IList<AIFunction>> _serverTools = new();
    private readonly Dictionary<string, bool> _initializedServers = new();
    private IList<AIFunction>? _managementFunctions;

    /// <inheritdoc />
    public string? ActiveServer { get; private set; }

    /// <inheritdoc />
    public IReadOnlyDictionary<string, bool> InitializedServers => _initializedServers;

    /// <summary>
    /// Creates a new ServerManager instance.
    /// </summary>
    /// <param name="client">The MCP client to manage.</param>
    /// <param name="logger">Optional logger.</param>
    public ServerManager(McpUseClient client, ILogger<ServerManager>? logger = null)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
        _logger = logger;
    }

    /// <inheritdoc />
    public IReadOnlyList<string> GetServerNames() => _client.ServerNames;

    /// <inheritdoc />
    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        var servers = _client.ServerNames;
        if (servers.Count == 0)
        {
            _logger?.LogWarning("No MCP servers defined in client configuration");
        }

        // Pre-fetch tools for all servers
        await PrefetchServerToolsAsync(cancellationToken);
    }

    private async Task PrefetchServerToolsAsync(CancellationToken cancellationToken = default)
    {
        var servers = _client.ServerNames;
        foreach (var serverName in servers)
        {
            try
            {
                var session = _client.GetSession(serverName);
                if (session is null)
                {
                    try
                    {
                        session = await _client.CreateSessionAsync(serverName, cancellationToken);
                        _logger?.LogDebug("Created session for server '{ServerName}' to prefetch tools", serverName);
                    }
                    catch (Exception ex)
                    {
                        _logger?.LogWarning(ex, "Could not create session for '{ServerName}' during prefetch", serverName);
                        continue;
                    }
                }

                var tools = await session.GetAIFunctionsAsync(cancellationToken);
                _serverTools[serverName] = tools.ToList();
                _initializedServers[serverName] = true;
                _logger?.LogDebug("Prefetched {Count} tools for server '{ServerName}'", _serverTools[serverName].Count, serverName);
            }
            catch (Exception ex)
            {
                _logger?.LogError(ex, "Error prefetching tools for server '{ServerName}'", serverName);
            }
        }
    }

    /// <inheritdoc />
    public async Task<IList<AIFunction>> GetAllFunctionsAsync(CancellationToken cancellationToken = default)
    {
        var allFunctions = new List<AIFunction>();

        // Add management functions
        allFunctions.AddRange(GetManagementFunctions());

        // Add active server functions if available
        if (ActiveServer != null && _serverTools.TryGetValue(ActiveServer, out var serverTools))
        {
            allFunctions.AddRange(serverTools);
            _logger?.LogDebug("Including {Count} tools from active server '{ServerName}'", serverTools.Count, ActiveServer);
        }
        else
        {
            _logger?.LogDebug("No active server - returning only management tools");
        }

        return allFunctions;
    }

    /// <inheritdoc />
    public IList<AIFunction> GetManagementFunctions()
    {
        _managementFunctions ??= CreateManagementFunctions();
        return _managementFunctions;
    }

    /// <inheritdoc />
    public async Task<IList<AIFunction>> GetActiveServerFunctionsAsync(CancellationToken cancellationToken = default)
    {
        if (ActiveServer != null && _serverTools.TryGetValue(ActiveServer, out var tools))
        {
            return tools;
        }
        return Array.Empty<AIFunction>();
    }

    /// <inheritdoc />
    public bool HasToolChanges(ISet<string> currentToolNames)
    {
        var newToolNames = new HashSet<string>();

        foreach (var func in GetManagementFunctions())
        {
            newToolNames.Add(func.Name);
        }

        if (ActiveServer != null && _serverTools.TryGetValue(ActiveServer, out var serverTools))
        {
            foreach (var func in serverTools)
            {
                newToolNames.Add(func.Name);
            }
        }

        return !newToolNames.SetEquals(currentToolNames);
    }

    /// <inheritdoc />
    public async Task<string> ConnectToServerAsync(string serverName, CancellationToken cancellationToken = default)
    {
        var servers = _client.ServerNames;
        if (!servers.Contains(serverName))
        {
            var available = servers.Count > 0 ? string.Join(", ", servers) : "none";
            return $"Server '{serverName}' not found. Available servers: {available}";
        }

        if (ActiveServer == serverName)
        {
            return $"Already connected to MCP server '{serverName}'";
        }

        try
        {
            var session = _client.GetSession(serverName);
            if (session is null)
            {
                _logger?.LogDebug("Creating new session for server '{ServerName}'", serverName);
                session = await _client.CreateSessionAsync(serverName, cancellationToken);
            }
            else
            {
                _logger?.LogDebug("Using existing session for server '{ServerName}'", serverName);
            }

            ActiveServer = serverName;

            // Initialize server tools if not already done
            if (!_serverTools.ContainsKey(serverName))
            {
                var tools = await session.GetAIFunctionsAsync(cancellationToken);
                _serverTools[serverName] = tools.ToList();
                _initializedServers[serverName] = true;
                _logger?.LogDebug("Loaded {Count} tools for server '{ServerName}'", _serverTools[serverName].Count, serverName);
            }

            var numTools = _serverTools.TryGetValue(serverName, out var serverTools) ? serverTools.Count : 0;
            return $"Connected to MCP server '{serverName}'. {numTools} tools are now available.";
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "Error connecting to server '{ServerName}'", serverName);
            return $"Error connecting to server '{serverName}': {ex.Message}";
        }
    }

    /// <inheritdoc />
    public Task<string> DisconnectFromServerAsync(CancellationToken cancellationToken = default)
    {
        if (ActiveServer is null)
        {
            return Task.FromResult("No server is currently active.");
        }

        var previousServer = ActiveServer;
        ActiveServer = null;
        return Task.FromResult($"Disconnected from MCP server '{previousServer}'.");
    }

    /// <inheritdoc />
    public async Task<IList<ToolSearchResult>> SearchToolsAsync(string query, int topK = 100, CancellationToken cancellationToken = default)
    {
        var results = new List<ToolSearchResult>();
        var queryLower = query.ToLowerInvariant();

        foreach (var (serverName, tools) in _serverTools)
        {
            foreach (var tool in tools)
            {
                var description = tool.Description ?? "";
                var nameLower = tool.Name.ToLowerInvariant();
                var descLower = description.ToLowerInvariant();

                // Simple text-based scoring (for semantic search, integrate with ML.NET or Azure Cognitive Services)
                double score = 0;
                if (nameLower.Contains(queryLower)) score += 2.0;
                if (descLower.Contains(queryLower)) score += 1.0;

                // Check for partial word matches
                var queryWords = queryLower.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                foreach (var word in queryWords)
                {
                    if (nameLower.Contains(word)) score += 0.5;
                    if (descLower.Contains(word)) score += 0.25;
                }

                if (score > 0)
                {
                    results.Add(new ToolSearchResult(serverName, tool.Name, description, score));
                }
            }
        }

        return results
            .OrderByDescending(r => r.Score)
            .ThenBy(r => r.ToolName)
            .Take(topK)
            .ToList();
    }

    private IList<AIFunction> CreateManagementFunctions()
    {
        return new List<AIFunction>
        {
            AIFunctionFactory.Create(ListMcpServersAsync, nameof(ListMcpServersAsync), "Lists all available MCP (Model Context Protocol) servers that can be connected to, along with the tools available on each server."),
            AIFunctionFactory.Create(ConnectToMcpServerAsync, nameof(ConnectToMcpServerAsync), "Connect to a specific MCP (Model Context Protocol) server to use its tools."),
            AIFunctionFactory.Create(GetActiveMcpServerAsync, nameof(GetActiveMcpServerAsync), "Gets the currently active MCP server name."),
            AIFunctionFactory.Create(DisconnectFromMcpServerAsync, nameof(DisconnectFromMcpServerAsync), "Disconnect from the currently active MCP server."),
            AIFunctionFactory.Create(SearchMcpToolsAsync, nameof(SearchMcpToolsAsync), "Search for relevant tools across all MCP servers using semantic search.")
        };
    }

    // Management tool implementations

    [Description("Lists all available MCP (Model Context Protocol) servers that can be connected to.")]
    private async Task<string> ListMcpServersAsync(CancellationToken cancellationToken = default)
    {
        var servers = _client.ServerNames;
        if (servers.Count == 0)
        {
            return "No MCP servers are currently defined.";
        }

        var result = new System.Text.StringBuilder("Available MCP servers:\n");
        for (int i = 0; i < servers.Count; i++)
        {
            var serverName = servers[i];
            var activeMarker = serverName == ActiveServer ? " (ACTIVE)" : "";
            result.AppendLine($"{i + 1}. {serverName}{activeMarker}");

            if (_serverTools.TryGetValue(serverName, out var tools))
            {
                result.AppendLine($"   {tools.Count} tools available for this server");
            }
        }

        return result.ToString();
    }

    [Description("Connect to a specific MCP server to use its tools.")]
    private async Task<string> ConnectToMcpServerAsync(
        [Description("The name of the MCP server to connect to")] string serverName,
        CancellationToken cancellationToken = default)
    {
        return await ConnectToServerAsync(serverName, cancellationToken);
    }

    [Description("Gets the currently active MCP server name.")]
    private Task<string> GetActiveMcpServerAsync(CancellationToken cancellationToken = default)
    {
        if (ActiveServer is null)
        {
            return Task.FromResult("No MCP server is currently active.");
        }
        return Task.FromResult($"Currently connected to MCP server: {ActiveServer}");
    }

    [Description("Disconnect from the currently active MCP server.")]
    private async Task<string> DisconnectFromMcpServerAsync(CancellationToken cancellationToken = default)
    {
        return await DisconnectFromServerAsync(cancellationToken);
    }

    [Description("Search for relevant tools across all MCP servers using semantic search.")]
    private async Task<string> SearchMcpToolsAsync(
        [Description("The search query to find relevant tools")] string query,
        [Description("The maximum number of tools to return")] int topK = 100,
        CancellationToken cancellationToken = default)
    {
        var results = await SearchToolsAsync(query, topK, cancellationToken);

        if (results.Count == 0)
        {
            return $"No tools found matching query: '{query}'";
        }

        var output = new System.Text.StringBuilder($"Found {results.Count} tools matching '{query}':\n");
        foreach (var result in results)
        {
            var activeMarker = result.ServerName == ActiveServer ? " (ACTIVE)" : "";
            output.AppendLine($"- {result.ServerName}{activeMarker}.{result.ToolName}: {result.Description}");
        }

        return output.ToString();
    }
}
