using McpUse.Configuration;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace McpUse.Client;

/// <summary>
/// High-level client for managing multiple MCP server connections.
/// </summary>
public sealed class McpUseClient : IAsyncDisposable
{
    private readonly ILogger<McpUseClient> _logger;
    private readonly ILoggerFactory? _loggerFactory;
    private readonly Dictionary<string, McpUseSession> _sessions = new();
    private readonly List<string> _activeSessions = new();
    private readonly object _lock = new();
    private bool _disposed;

    /// <summary>
    /// Gets the configuration used by this client.
    /// </summary>
    public McpConfiguration Configuration { get; }

    /// <summary>
    /// Gets the names of all configured servers.
    /// </summary>
    public IReadOnlyList<string> ServerNames => Configuration.McpServers
        .Where(kvp => kvp.Value.Enabled)
        .Select(kvp => kvp.Key)
        .ToList();

    /// <summary>
    /// Gets the names of all active (connected) sessions.
    /// </summary>
    public IReadOnlyList<string> ActiveSessions
    {
        get
        {
            lock (_lock)
            {
                return _activeSessions.ToList();
            }
        }
    }

    /// <summary>
    /// Creates a new McpUseClient with the specified configuration.
    /// </summary>
    /// <param name="configuration">MCP configuration.</param>
    /// <param name="loggerFactory">Optional logger factory.</param>
    public McpUseClient(McpConfiguration configuration, ILoggerFactory? loggerFactory = null)
    {
        Configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
        _loggerFactory = loggerFactory;
        _logger = loggerFactory?.CreateLogger<McpUseClient>() ?? NullLogger<McpUseClient>.Instance;
    }

    /// <summary>
    /// Create a client from a configuration file (Claude Desktop format).
    /// </summary>
    /// <param name="filePath">Path to the JSON configuration file.</param>
    /// <param name="loggerFactory">Optional logger factory.</param>
    /// <returns>A new McpUseClient instance.</returns>
    public static McpUseClient FromConfigFile(string filePath, ILoggerFactory? loggerFactory = null)
    {
        var config = ConfigLoader.FromFile(filePath);
        return new McpUseClient(config, loggerFactory);
    }

    /// <summary>
    /// Create a client from a configuration file asynchronously.
    /// </summary>
    /// <param name="filePath">Path to the JSON configuration file.</param>
    /// <param name="loggerFactory">Optional logger factory.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A new McpUseClient instance.</returns>
    public static async Task<McpUseClient> FromConfigFileAsync(
        string filePath,
        ILoggerFactory? loggerFactory = null,
        CancellationToken cancellationToken = default)
    {
        var config = await ConfigLoader.FromFileAsync(filePath, cancellationToken);
        return new McpUseClient(config, loggerFactory);
    }

    /// <summary>
    /// Create a client from a dictionary configuration.
    /// </summary>
    /// <param name="config">Dictionary with mcpServers configuration.</param>
    /// <param name="loggerFactory">Optional logger factory.</param>
    /// <returns>A new McpUseClient instance.</returns>
    public static McpUseClient FromDictionary(Dictionary<string, object> config, ILoggerFactory? loggerFactory = null)
    {
        var mcpConfig = ConfigLoader.FromDictionary(config);
        return new McpUseClient(mcpConfig, loggerFactory);
    }

    /// <summary>
    /// Create a client from a JSON string.
    /// </summary>
    /// <param name="json">JSON configuration string.</param>
    /// <param name="loggerFactory">Optional logger factory.</param>
    /// <returns>A new McpUseClient instance.</returns>
    public static McpUseClient FromJson(string json, ILoggerFactory? loggerFactory = null)
    {
        var config = ConfigLoader.FromJson(json);
        return new McpUseClient(config, loggerFactory);
    }

    /// <summary>
    /// Add a new server configuration dynamically.
    /// </summary>
    /// <param name="name">Server name.</param>
    /// <param name="serverConfig">Server configuration.</param>
    public void AddServer(string name, McpServerConfig serverConfig)
    {
        if (_disposed) throw new ObjectDisposedException(nameof(McpUseClient));

        lock (_lock)
        {
            Configuration.McpServers[name] = serverConfig;
        }

        _logger.LogInformation("Added server configuration: {Name}", name);
    }

    /// <summary>
    /// Remove a server configuration.
    /// </summary>
    /// <param name="name">Server name to remove.</param>
    public async Task RemoveServerAsync(string name)
    {
        if (_disposed) throw new ObjectDisposedException(nameof(McpUseClient));

        McpUseSession? session = null;

        lock (_lock)
        {
            Configuration.McpServers.Remove(name);

            if (_sessions.TryGetValue(name, out session))
            {
                _sessions.Remove(name);
                _activeSessions.Remove(name);
            }
        }

        if (session is not null)
        {
            await session.DisposeAsync();
        }

        _logger.LogInformation("Removed server: {Name}", name);
    }

    /// <summary>
    /// Create and connect a session for the specified server.
    /// </summary>
    /// <param name="serverName">Name of the server to connect to.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The connected session.</returns>
    public async Task<McpUseSession> CreateSessionAsync(string serverName, CancellationToken cancellationToken = default)
    {
        if (_disposed) throw new ObjectDisposedException(nameof(McpUseClient));

        lock (_lock)
        {
            if (_sessions.TryGetValue(serverName, out var existingSession) && existingSession.IsConnected)
            {
                return existingSession;
            }
        }

        if (!Configuration.McpServers.TryGetValue(serverName, out var config))
        {
            throw new McpConfigurationException($"Server '{serverName}' not found in configuration");
        }

        if (!config.Enabled)
        {
            throw new McpConfigurationException($"Server '{serverName}' is disabled");
        }

        var sessionLogger = _loggerFactory?.CreateLogger<McpUseSession>();
        var session = new McpUseSession(serverName, config, sessionLogger);

        try
        {
            await session.ConnectAsync(cancellationToken);

            lock (_lock)
            {
                _sessions[serverName] = session;
                if (!_activeSessions.Contains(serverName))
                {
                    _activeSessions.Add(serverName);
                }
            }

            return session;
        }
        catch (Exception ex)
        {
            await session.DisposeAsync();
            throw new McpConnectionException(serverName, $"Failed to connect to server '{serverName}'", ex);
        }
    }

    /// <summary>
    /// Create and connect sessions for all configured servers.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Dictionary of connected sessions.</returns>
    public async Task<IReadOnlyDictionary<string, McpUseSession>> CreateAllSessionsAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed) throw new ObjectDisposedException(nameof(McpUseClient));

        var enabledServers = Configuration.McpServers
            .Where(kvp => kvp.Value.Enabled)
            .Select(kvp => kvp.Key)
            .ToList();

        _logger.LogInformation("Creating sessions for {Count} servers", enabledServers.Count);

        var tasks = enabledServers.Select(async name =>
        {
            try
            {
                return await CreateSessionAsync(name, cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to connect to server: {Name}", name);
                return null;
            }
        });

        await Task.WhenAll(tasks);

        lock (_lock)
        {
            return _sessions.ToDictionary(kvp => kvp.Key, kvp => kvp.Value);
        }
    }

    /// <summary>
    /// Get an existing session by name.
    /// </summary>
    /// <param name="serverName">Server name.</param>
    /// <returns>The session, or null if not connected.</returns>
    public McpUseSession? GetSession(string serverName)
    {
        lock (_lock)
        {
            return _sessions.TryGetValue(serverName, out var session) ? session : null;
        }
    }

    /// <summary>
    /// Get all active sessions.
    /// </summary>
    /// <returns>Dictionary of active sessions.</returns>
    public IReadOnlyDictionary<string, McpUseSession> GetAllActiveSessions()
    {
        lock (_lock)
        {
            return _sessions
                .Where(kvp => kvp.Value.IsConnected)
                .ToDictionary(kvp => kvp.Key, kvp => kvp.Value);
        }
    }

    /// <summary>
    /// Get all tools from all active sessions.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>List of all available tools.</returns>
    public async Task<IList<AIFunction>> GetAllToolsAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed) throw new ObjectDisposedException(nameof(McpUseClient));

        var tools = new List<AIFunction>();

        IReadOnlyDictionary<string, McpUseSession> sessions;
        lock (_lock)
        {
            sessions = _sessions.ToDictionary(kvp => kvp.Key, kvp => kvp.Value);
        }

        foreach (var session in sessions.Values.Where(s => s.IsConnected))
        {
            var sessionTools = await session.GetAIFunctionsAsync(cancellationToken);
            tools.AddRange(sessionTools);
        }

        _logger.LogDebug("Found {Count} total tools from {SessionCount} sessions", tools.Count, sessions.Count);

        return tools;
    }

    /// <summary>
    /// Close a specific session.
    /// </summary>
    /// <param name="serverName">Server name.</param>
    public async Task CloseSessionAsync(string serverName)
    {
        McpUseSession? session;

        lock (_lock)
        {
            if (!_sessions.TryGetValue(serverName, out session))
                return;

            _sessions.Remove(serverName);
            _activeSessions.Remove(serverName);
        }

        await session.DisposeAsync();
        _logger.LogInformation("Closed session: {Name}", serverName);
    }

    /// <summary>
    /// Close all sessions.
    /// </summary>
    public async Task CloseAllSessionsAsync()
    {
        List<McpUseSession> sessions;

        lock (_lock)
        {
            sessions = _sessions.Values.ToList();
            _sessions.Clear();
            _activeSessions.Clear();
        }

        foreach (var session in sessions)
        {
            await session.DisposeAsync();
        }

        _logger.LogInformation("Closed all sessions");
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;

        await CloseAllSessionsAsync();
    }
}
