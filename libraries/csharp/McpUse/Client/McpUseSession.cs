using McpUse.Configuration;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using ModelContextProtocol;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace McpUse.Client;

/// <summary>
/// Represents a session with a single MCP server.
/// Wraps the official McpClient and provides higher-level operations.
/// </summary>
public sealed class McpUseSession : IAsyncDisposable
{
    private readonly ILogger<McpUseSession> _logger;
    private readonly McpServerConfig _config;
    private McpClient? _client;
    private IList<McpClientTool>? _tools;
    private IList<McpClientResource>? _resources;
    private IList<McpClientPrompt>? _prompts;
    private bool _initialized;
    private bool _disposed;

    /// <summary>
    /// Gets the name of this server session.
    /// </summary>
    public string Name { get; }

    /// <summary>
    /// Gets whether this session is connected and initialized.
    /// </summary>
    public bool IsConnected => _client is not null && _initialized;

    /// <summary>
    /// Gets the server information after initialization.
    /// </summary>
    public Implementation? ServerInfo { get; private set; }

    /// <summary>
    /// Gets the server capabilities after initialization.
    /// </summary>
    public ServerCapabilities? Capabilities { get; private set; }

    /// <summary>
    /// Creates a new MCP session.
    /// </summary>
    /// <param name="name">Name identifying this server.</param>
    /// <param name="config">Server configuration.</param>
    /// <param name="logger">Optional logger.</param>
    public McpUseSession(string name, McpServerConfig config, ILogger<McpUseSession>? logger = null)
    {
        Name = name ?? throw new ArgumentNullException(nameof(name));
        _config = config ?? throw new ArgumentNullException(nameof(config));
        _logger = logger ?? NullLogger<McpUseSession>.Instance;
    }

    /// <summary>
    /// Connect to the MCP server and initialize the session.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed) throw new ObjectDisposedException(nameof(McpUseSession));
        if (_initialized) return;

        _logger.LogDebug("Connecting to MCP server: {Name}", Name);

        try
        {
            var transport = CreateTransport();
            _client = await McpClient.CreateAsync(transport, cancellationToken: cancellationToken);

            // Store server info from initialization
            ServerInfo = _client.ServerInfo;
            Capabilities = _client.ServerCapabilities;

            _initialized = true;
            _logger.LogInformation("Connected to MCP server: {Name} ({ServerName} v{Version})",
                Name, ServerInfo?.Name ?? "unknown", ServerInfo?.Version ?? "unknown");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to connect to MCP server: {Name}", Name);
            throw new McpUseException($"Failed to connect to MCP server '{Name}'", ex);
        }
    }

    /// <summary>
    /// Get all available tools from this server.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>List of available tools.</returns>
    public async Task<IList<McpClientTool>> ListToolsAsync(CancellationToken cancellationToken = default)
    {
        EnsureConnected();

        if (_tools is not null)
            return _tools;

        _tools = await _client!.ListToolsAsync(cancellationToken: cancellationToken);
        _logger.LogDebug("Found {Count} tools from server {Name}", _tools.Count, Name);

        return _tools;
    }

    /// <summary>
    /// Get all available resources from this server.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>List of available resources.</returns>
    public async Task<IList<McpClientResource>> ListResourcesAsync(CancellationToken cancellationToken = default)
    {
        EnsureConnected();

        if (_resources is not null)
            return _resources;

        if (Capabilities?.Resources is null)
        {
            _resources = Array.Empty<McpClientResource>();
            return _resources;
        }

        _resources = await _client!.ListResourcesAsync(cancellationToken: cancellationToken);
        _logger.LogDebug("Found {Count} resources from server {Name}", _resources.Count, Name);

        return _resources;
    }

    /// <summary>
    /// Get all available prompts from this server.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>List of available prompts.</returns>
    public async Task<IList<McpClientPrompt>> ListPromptsAsync(CancellationToken cancellationToken = default)
    {
        EnsureConnected();

        if (_prompts is not null)
            return _prompts;

        if (Capabilities?.Prompts is null)
        {
            _prompts = Array.Empty<McpClientPrompt>();
            return _prompts;
        }

        _prompts = await _client!.ListPromptsAsync(cancellationToken: cancellationToken);
        _logger.LogDebug("Found {Count} prompts from server {Name}", _prompts.Count, Name);

        return _prompts;
    }

    /// <summary>
    /// Call a tool by name with the specified arguments.
    /// </summary>
    /// <param name="toolName">Name of the tool to call.</param>
    /// <param name="arguments">Arguments to pass to the tool.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The tool result.</returns>
    public async Task<CallToolResult> CallToolAsync(
        string toolName,
        IReadOnlyDictionary<string, object?>? arguments = null,
        CancellationToken cancellationToken = default)
    {
        EnsureConnected();

        _logger.LogDebug("Calling tool {Tool} on server {Name}", toolName, Name);

        var result = await _client!.CallToolAsync(toolName, arguments, cancellationToken: cancellationToken);

        _logger.LogDebug("Tool {Tool} completed with {Count} content blocks", toolName, result.Content.Count);

        return result;
    }

    /// <summary>
    /// Read a resource by URI.
    /// </summary>
    /// <param name="uri">Resource URI.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The resource content.</returns>
    public async Task<ReadResourceResult> ReadResourceAsync(string uri, CancellationToken cancellationToken = default)
    {
        EnsureConnected();

        _logger.LogDebug("Reading resource {Uri} from server {Name}", uri, Name);

        return await _client!.ReadResourceAsync(new Uri(uri), cancellationToken: cancellationToken);
    }

    /// <summary>
    /// Get a prompt by name.
    /// </summary>
    /// <param name="promptName">Name of the prompt.</param>
    /// <param name="arguments">Optional arguments for the prompt.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The prompt result.</returns>
    public async Task<GetPromptResult> GetPromptAsync(
        string promptName,
        IDictionary<string, string>? arguments = null,
        CancellationToken cancellationToken = default)
    {
        EnsureConnected();

        _logger.LogDebug("Getting prompt {Prompt} from server {Name}", promptName, Name);

        return await _client!.GetPromptAsync(promptName, arguments?.ToDictionary(kv => kv.Key, kv => (object?)kv.Value), cancellationToken: cancellationToken);
    }

    /// <summary>
    /// Gets tools as AIFunctions for use with IChatClient.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Collection of AI functions.</returns>
    public async Task<IEnumerable<AIFunction>> GetAIFunctionsAsync(CancellationToken cancellationToken = default)
    {
        var tools = await ListToolsAsync(cancellationToken);
        // McpClientTool inherits from AIFunction, so we can cast directly
        return tools.Cast<AIFunction>();
    }

    /// <summary>
    /// Invalidate cached tools, resources, and prompts.
    /// Call this if the server notifies of changes.
    /// </summary>
    public void InvalidateCache()
    {
        _tools = null;
        _resources = null;
        _prompts = null;
    }

    private IClientTransport CreateTransport()
    {
        if (_config.IsStdio)
        {
            return new StdioClientTransport(new StdioClientTransportOptions
            {
                Name = Name,
                Command = _config.Command!,
                Arguments = _config.Args ?? [],
                EnvironmentVariables = _config.Env?.ToDictionary(kv => kv.Key, kv => kv.Value ?? "")
            });
        }

        if (_config.IsHttp)
        {
            return new HttpClientTransport(new HttpClientTransportOptions
            {
                Name = Name,
                Endpoint = new Uri(_config.Url!)
            });
        }

        throw new McpUseException($"Invalid server configuration for '{Name}': must specify either 'command' (stdio) or 'url' (http)");
    }

    private void EnsureConnected()
    {
        if (_disposed) throw new ObjectDisposedException(nameof(McpUseSession));
        if (!_initialized || _client is null)
            throw new InvalidOperationException($"Session '{Name}' is not connected. Call ConnectAsync first.");
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;

        if (_client is not null)
        {
            _logger.LogDebug("Disposing MCP session: {Name}", Name);
            await _client.DisposeAsync();
            _client = null;
        }

        _tools = null;
        _resources = null;
        _prompts = null;
        _initialized = false;
    }
}
