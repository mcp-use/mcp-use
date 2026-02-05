using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace McpUse.Connectors;

/// <summary>
/// Connector for MCP servers running in a sandbox environment.
/// Supports E2B (https://e2b.dev) and similar cloud sandboxes.
/// </summary>
public class SandboxConnector : IConnector
{
    private readonly string _command;
    private readonly string[] _args;
    private readonly Dictionary<string, string>? _env;
    private readonly SandboxOptions _options;
    private readonly TimeSpan _timeout;

    private ISandboxProvider? _sandbox;
    private HttpConnector? _httpConnector;
    private bool _isConnected;

    public string Name => "sandbox";
    public bool IsConnected => _isConnected && (_httpConnector?.IsConnected ?? false);

    public event EventHandler<JsonRpcNotification>? NotificationReceived;
    public event EventHandler<Exception?>? Disconnected;

    /// <summary>
    /// Creates a new sandbox connector.
    /// </summary>
    /// <param name="command">The MCP server command to execute in the sandbox.</param>
    /// <param name="args">Arguments for the MCP server command.</param>
    /// <param name="env">Environment variables for the command.</param>
    /// <param name="options">Sandbox configuration options.</param>
    /// <param name="timeout">Timeout for operations (default: 30 seconds).</param>
    public SandboxConnector(
        string command,
        string[]? args = null,
        Dictionary<string, string>? env = null,
        SandboxOptions? options = null,
        TimeSpan? timeout = null)
    {
        _command = command ?? throw new ArgumentNullException(nameof(command));
        _args = args ?? Array.Empty<string>();
        _env = env;
        _options = options ?? new SandboxOptions();
        _timeout = timeout ?? TimeSpan.FromSeconds(30);
    }

    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        if (_isConnected)
            return;

        // Create sandbox provider based on options
        _sandbox = CreateSandboxProvider();

        // Start the sandbox
        await _sandbox.StartAsync(cancellationToken);

        // Build the full command with supergateway wrapper
        var fullCommand = BuildSupergatewayCommand();

        // Execute the command in the sandbox
        var endpoint = await _sandbox.ExecuteCommandAsync(fullCommand, _env, cancellationToken);

        // Connect via HTTP to the supergateway endpoint
        _httpConnector = new HttpConnector(endpoint);
        _httpConnector.NotificationReceived += (s, e) => NotificationReceived?.Invoke(this, e);
        _httpConnector.Disconnected += (s, e) => Disconnected?.Invoke(this, e);

        await _httpConnector.ConnectAsync(cancellationToken);

        _isConnected = true;
    }

    public async Task DisconnectAsync(CancellationToken cancellationToken = default)
    {
        _isConnected = false;

        if (_httpConnector != null)
        {
            await _httpConnector.DisconnectAsync(cancellationToken);
            _httpConnector = null;
        }

        if (_sandbox != null)
        {
            await _sandbox.StopAsync(cancellationToken);
            _sandbox = null;
        }
    }

    public async Task<JsonRpcResponse> SendRequestAsync(JsonRpcRequest request, CancellationToken cancellationToken = default)
    {
        if (_httpConnector == null)
            throw new McpConnectionException("Not connected");

        return await _httpConnector.SendRequestAsync(request, cancellationToken);
    }

    public async Task SendNotificationAsync(JsonRpcNotification notification, CancellationToken cancellationToken = default)
    {
        if (_httpConnector == null)
            throw new McpConnectionException("Not connected");

        await _httpConnector.SendNotificationAsync(notification, cancellationToken);
    }

    private ISandboxProvider CreateSandboxProvider()
    {
        return _options.Provider switch
        {
            SandboxProviderType.E2B => new E2BSandboxProvider(_options),
            SandboxProviderType.Docker => new DockerSandboxProvider(_options),
            SandboxProviderType.Custom => _options.CustomProvider
                ?? throw new InvalidOperationException("CustomProvider is required when Provider is Custom"),
            _ => throw new InvalidOperationException($"Unknown sandbox provider: {_options.Provider}")
        };
    }

    private string BuildSupergatewayCommand()
    {
        var sb = new StringBuilder();

        // Supergateway wraps stdio commands and exposes them via HTTP
        sb.Append(_options.SupergatewayCommand ?? "npx -y supergateway");
        sb.Append(" --stdio \"");
        sb.Append(_command);

        foreach (var arg in _args)
        {
            sb.Append(' ');
            sb.Append(arg.Contains(' ') ? $"\\\"{arg}\\\"" : arg);
        }

        sb.Append('"');

        if (_options.SupergatewayPort.HasValue)
        {
            sb.Append($" --port {_options.SupergatewayPort.Value}");
        }

        return sb.ToString();
    }

    public async ValueTask DisposeAsync()
    {
        await DisconnectAsync();
        GC.SuppressFinalize(this);
    }
}

/// <summary>
/// Configuration options for sandbox execution.
/// </summary>
public class SandboxOptions
{
    /// <summary>
    /// The sandbox provider to use.
    /// </summary>
    public SandboxProviderType Provider { get; set; } = SandboxProviderType.E2B;

    /// <summary>
    /// API key for the sandbox provider.
    /// </summary>
    public string? ApiKey { get; set; }

    /// <summary>
    /// Template ID for the sandbox environment (E2B).
    /// </summary>
    public string SandboxTemplateId { get; set; } = "base";

    /// <summary>
    /// Command to run supergateway.
    /// </summary>
    public string? SupergatewayCommand { get; set; }

    /// <summary>
    /// Port for supergateway (optional).
    /// </summary>
    public int? SupergatewayPort { get; set; }

    /// <summary>
    /// Timeout for sandbox operations.
    /// </summary>
    public TimeSpan Timeout { get; set; } = TimeSpan.FromMinutes(5);

    /// <summary>
    /// Custom sandbox provider instance.
    /// </summary>
    public ISandboxProvider? CustomProvider { get; set; }
}

/// <summary>
/// Types of sandbox providers.
/// </summary>
public enum SandboxProviderType
{
    E2B,
    Docker,
    Custom
}

/// <summary>
/// Interface for sandbox providers.
/// </summary>
public interface ISandboxProvider : IAsyncDisposable
{
    /// <summary>
    /// Starts the sandbox environment.
    /// </summary>
    Task StartAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Stops the sandbox environment.
    /// </summary>
    Task StopAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Executes a command in the sandbox and returns the HTTP endpoint.
    /// </summary>
    Task<string> ExecuteCommandAsync(string command, Dictionary<string, string>? env, CancellationToken cancellationToken = default);
}

/// <summary>
/// E2B sandbox provider implementation.
/// </summary>
public class E2BSandboxProvider : ISandboxProvider
{
    private readonly SandboxOptions _options;
    private HttpClient? _httpClient;
    private string? _sandboxId;

    public E2BSandboxProvider(SandboxOptions options)
    {
        _options = options;
    }

    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        var apiKey = _options.ApiKey ?? Environment.GetEnvironmentVariable("E2B_API_KEY")
            ?? throw new InvalidOperationException("E2B API key is required. Set E2B_API_KEY environment variable or provide in options.");

        _httpClient = new HttpClient
        {
            BaseAddress = new Uri("https://api.e2b.dev/"),
            Timeout = _options.Timeout
        };
        _httpClient.DefaultRequestHeaders.Add("X-API-Key", apiKey);

        // Create sandbox instance
        var createRequest = new
        {
            templateID = _options.SandboxTemplateId,
            timeout = (int)_options.Timeout.TotalSeconds
        };

        var response = await _httpClient.PostAsJsonAsync("sandboxes", createRequest, cancellationToken);
        response.EnsureSuccessStatusCode();

        var result = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken);
        _sandboxId = result.GetProperty("sandboxID").GetString();
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        if (_httpClient != null && _sandboxId != null)
        {
            try
            {
                await _httpClient.DeleteAsync($"sandboxes/{_sandboxId}", cancellationToken);
            }
            catch
            {
                // Best-effort sandbox cleanup; ignore errors
            }
        }

        _httpClient?.Dispose();
        _httpClient = null;
        _sandboxId = null;
    }

    public async Task<string> ExecuteCommandAsync(string command, Dictionary<string, string>? env, CancellationToken cancellationToken = default)
    {
        if (_httpClient == null || _sandboxId == null)
            throw new InvalidOperationException("Sandbox not started");

        var execRequest = new
        {
            cmd = command,
            env = env ?? new Dictionary<string, string>(),
            background = true
        };

        var response = await _httpClient.PostAsJsonAsync($"sandboxes/{_sandboxId}/commands", execRequest, cancellationToken);
        response.EnsureSuccessStatusCode();

        var result = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken);
        var host = result.GetProperty("host").GetString();
        var port = result.GetProperty("port").GetInt32();

        return $"https://{host}:{port}";
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
    }
}

/// <summary>
/// Docker sandbox provider implementation.
/// </summary>
public class DockerSandboxProvider : ISandboxProvider
{
    private readonly SandboxOptions _options;
    private string? _containerId;

    public DockerSandboxProvider(SandboxOptions options)
    {
        _options = options;
    }

    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        // Start a Docker container
        using var process = new System.Diagnostics.Process
        {
            StartInfo = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "docker",
                Arguments = $"run -d --rm -p 8080 {_options.SandboxTemplateId}",
                RedirectStandardOutput = true,
                UseShellExecute = false
            }
        };

        process.Start();
        _containerId = (await process.StandardOutput.ReadToEndAsync(cancellationToken)).Trim();
        await process.WaitForExitAsync(cancellationToken);
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        if (_containerId != null)
        {
            using var process = new System.Diagnostics.Process
            {
                StartInfo = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "docker",
                    Arguments = $"stop {_containerId}",
                    UseShellExecute = false
                }
            };
            process.Start();
            await process.WaitForExitAsync(cancellationToken);
            _containerId = null;
        }
    }

    public async Task<string> ExecuteCommandAsync(string command, Dictionary<string, string>? env, CancellationToken cancellationToken = default)
    {
        if (_containerId == null)
            throw new InvalidOperationException("Container not started");

        // Get the mapped port
        using var process = new System.Diagnostics.Process
        {
            StartInfo = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "docker",
                Arguments = $"port {_containerId} 8080",
                RedirectStandardOutput = true,
                UseShellExecute = false
            }
        };

        process.Start();
        var portMapping = (await process.StandardOutput.ReadToEndAsync(cancellationToken)).Trim();
        await process.WaitForExitAsync(cancellationToken);

        // Execute the command in the container
        var envArgs = env != null
            ? string.Join(" ", env.Select(kv => $"-e {kv.Key}={kv.Value}"))
            : "";

        using var execProcess = new System.Diagnostics.Process
        {
            StartInfo = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "docker",
                Arguments = $"exec -d {envArgs} {_containerId} {command}",
                UseShellExecute = false
            }
        };

        execProcess.Start();
        await execProcess.WaitForExitAsync(cancellationToken);

        // Parse port mapping (format: "0.0.0.0:32768")
        var parts = portMapping.Split(':');
        var port = parts.Length > 1 ? parts[1] : "8080";

        return $"http://localhost:{port}";
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
    }
}
