using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace McpUse.Connectors;

/// <summary>
/// Connector for MCP servers using stdio (standard input/output) transport.
/// This is the primary connector for local MCP servers launched as child processes.
/// </summary>
public class StdioConnector : IConnector
{
    private readonly string _command;
    private readonly string[] _args;
    private readonly Dictionary<string, string>? _env;
    private readonly string? _workingDirectory;
    private readonly TimeSpan _timeout;

    private Process? _process;
    private StreamWriter? _stdin;
    private Task? _readTask;
    private CancellationTokenSource? _cts;
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonRpcResponse>> _pendingRequests = new();
    private readonly JsonSerializerOptions _jsonOptions;

    public string Name => "stdio";
    public bool IsConnected => _process != null && !_process.HasExited;

    public event EventHandler<JsonRpcNotification>? NotificationReceived;
    public event EventHandler<Exception?>? Disconnected;

    /// <summary>
    /// Creates a new stdio connector.
    /// </summary>
    /// <param name="command">The command to execute (e.g., "dotnet", "node", "python").</param>
    /// <param name="args">Arguments to pass to the command.</param>
    /// <param name="env">Optional environment variables for the process.</param>
    /// <param name="workingDirectory">Optional working directory for the process.</param>
    /// <param name="timeout">Timeout for requests (default: 30 seconds).</param>
    public StdioConnector(
        string command,
        string[]? args = null,
        Dictionary<string, string>? env = null,
        string? workingDirectory = null,
        TimeSpan? timeout = null)
    {
        _command = command ?? throw new ArgumentNullException(nameof(command));
        _args = args ?? Array.Empty<string>();
        _env = env;
        _workingDirectory = workingDirectory;
        _timeout = timeout ?? TimeSpan.FromSeconds(30);

        _jsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true
        };
    }

    /// <summary>
    /// Creates a stdio connector from a server configuration dictionary.
    /// </summary>
    public static StdioConnector FromConfig(Dictionary<string, object> config)
    {
        var command = config.TryGetValue("command", out var cmd) ? cmd.ToString()! : throw new ArgumentException("command is required");

        string[]? args = null;
        if (config.TryGetValue("args", out var argsObj))
        {
            args = argsObj switch
            {
                string[] arr => arr,
                IEnumerable<object> enumerable => enumerable.Select(x => x.ToString()!).ToArray(),
                JsonElement je when je.ValueKind == JsonValueKind.Array => je.EnumerateArray().Select(x => x.GetString()!).ToArray(),
                _ => null
            };
        }

        Dictionary<string, string>? env = null;
        if (config.TryGetValue("env", out var envObj) && envObj is Dictionary<string, object> envDict)
        {
            env = envDict.ToDictionary(kv => kv.Key, kv => kv.Value.ToString()!);
        }

        string? workingDir = config.TryGetValue("workingDirectory", out var wd) ? wd.ToString() : null;

        return new StdioConnector(command, args, env, workingDir);
    }

    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        if (IsConnected)
            return;

        var startInfo = new ProcessStartInfo
        {
            FileName = _command,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            StandardInputEncoding = Encoding.UTF8,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };

        foreach (var arg in _args)
        {
            startInfo.ArgumentList.Add(arg);
        }

        if (_workingDirectory != null)
        {
            startInfo.WorkingDirectory = _workingDirectory;
        }

        if (_env != null)
        {
            foreach (var (key, value) in _env)
            {
                startInfo.Environment[key] = value;
            }
        }

        _process = new Process { StartInfo = startInfo };
        _process.EnableRaisingEvents = true;
        _process.Exited += OnProcessExited;

        if (!_process.Start())
        {
            throw new McpConnectionException($"Failed to start process: {_command}");
        }

        _stdin = _process.StandardInput;
        _cts = new CancellationTokenSource();

        // Start reading stdout for responses
        _readTask = ReadOutputAsync(_cts.Token);

        // Wait a moment for the process to initialize
        await Task.Delay(100, cancellationToken);

        if (_process.HasExited)
        {
            var stderr = await _process.StandardError.ReadToEndAsync(cancellationToken);
            throw new McpConnectionException($"Process exited immediately: {stderr}");
        }
    }

    public async Task DisconnectAsync(CancellationToken cancellationToken = default)
    {
        _cts?.Cancel();

        if (_stdin != null)
        {
            try
            {
                await _stdin.DisposeAsync();
            }
            catch
            {
                // Ignore errors during stream disposal
            }
            _stdin = null;
        }

        if (_process != null)
        {
            try
            {
                if (!_process.HasExited)
                {
                    _process.Kill(entireProcessTree: true);
                    await _process.WaitForExitAsync(cancellationToken);
                }
            }
            catch
            {
                // Ignore errors during process termination
            }
            _process.Dispose();
            _process = null;
        }

        if (_readTask != null)
        {
            try
            {
                await _readTask;
            }
            catch (OperationCanceledException) { }
            _readTask = null;
        }

        // Complete all pending requests with cancellation
        foreach (var pending in _pendingRequests.Values)
        {
            pending.TrySetCanceled();
        }
        _pendingRequests.Clear();
    }

    public async Task<JsonRpcResponse> SendRequestAsync(JsonRpcRequest request, CancellationToken cancellationToken = default)
    {
        if (!IsConnected || _stdin == null)
            throw new McpConnectionException("Not connected");

        var tcs = new TaskCompletionSource<JsonRpcResponse>();
        _pendingRequests[request.Id] = tcs;

        try
        {
            var json = JsonSerializer.Serialize(request, _jsonOptions);
            await _stdin.WriteLineAsync(json);
            await _stdin.FlushAsync(cancellationToken);

            using var timeoutCts = new CancellationTokenSource(_timeout);
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);

            var completedTask = await Task.WhenAny(tcs.Task, Task.Delay(Timeout.Infinite, linkedCts.Token));

            if (completedTask == tcs.Task)
            {
                return await tcs.Task;
            }

            throw new TimeoutException($"Request timed out after {_timeout.TotalSeconds} seconds");
        }
        finally
        {
            _pendingRequests.TryRemove(request.Id, out _);
        }
    }

    public async Task SendNotificationAsync(JsonRpcNotification notification, CancellationToken cancellationToken = default)
    {
        if (!IsConnected || _stdin == null)
            throw new McpConnectionException("Not connected");

        var json = JsonSerializer.Serialize(notification, _jsonOptions);
        await _stdin.WriteLineAsync(json);
        await _stdin.FlushAsync(cancellationToken);
    }

    private async Task ReadOutputAsync(CancellationToken cancellationToken)
    {
        if (_process == null) return;

        var reader = _process.StandardOutput;

        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var line = await reader.ReadLineAsync(cancellationToken);
                if (line == null) break; // EOF

                try
                {
                    ProcessMessage(line);
                }
                catch (JsonException)
                {
                    // Skip malformed JSON
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            Disconnected?.Invoke(this, ex);
        }
    }

    private void ProcessMessage(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        // Check if it's a response (has id) or notification (no id)
        if (root.TryGetProperty("id", out var idElement) && idElement.ValueKind != JsonValueKind.Null)
        {
            var id = idElement.GetString() ?? idElement.GetRawText();
            var response = JsonSerializer.Deserialize<JsonRpcResponse>(json, _jsonOptions)!;

            if (_pendingRequests.TryRemove(id, out var tcs))
            {
                tcs.TrySetResult(response);
            }
        }
        else
        {
            // It's a notification
            var notification = JsonSerializer.Deserialize<JsonRpcNotification>(json, _jsonOptions)!;
            NotificationReceived?.Invoke(this, notification);
        }
    }

    private void OnProcessExited(object? sender, EventArgs e)
    {
        Disconnected?.Invoke(this, null);
    }

    public async ValueTask DisposeAsync()
    {
        await DisconnectAsync();
        GC.SuppressFinalize(this);
    }
}

/// <summary>
/// Exception thrown when MCP connection fails.
/// </summary>
public class McpConnectionException : Exception
{
    public McpConnectionException(string message) : base(message) { }
    public McpConnectionException(string message, Exception inner) : base(message, inner) { }
}
