using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace McpUse.Connectors;

/// <summary>
/// Configuration for WebSocket connections.
/// </summary>
public class WebSocketConnectorOptions
{
    /// <summary>
    /// WebSocket server URI.
    /// </summary>
    public required Uri Uri { get; init; }

    /// <summary>
    /// Connection timeout in milliseconds.
    /// </summary>
    public int ConnectionTimeoutMs { get; init; } = 30000;

    /// <summary>
    /// Keep-alive interval in milliseconds (0 to disable).
    /// </summary>
    public int KeepAliveIntervalMs { get; init; } = 30000;

    /// <summary>
    /// Receive buffer size in bytes.
    /// </summary>
    public int ReceiveBufferSize { get; init; } = 8192;

    /// <summary>
    /// Whether to automatically reconnect on disconnect.
    /// </summary>
    public bool AutoReconnect { get; init; } = true;

    /// <summary>
    /// Maximum reconnection attempts (0 for unlimited).
    /// </summary>
    public int MaxReconnectAttempts { get; init; } = 5;

    /// <summary>
    /// Delay between reconnection attempts in milliseconds.
    /// </summary>
    public int ReconnectDelayMs { get; init; } = 1000;

    /// <summary>
    /// Authentication token for the connection.
    /// </summary>
    public string? AuthToken { get; init; }

    /// <summary>
    /// Custom headers to include in the connection request.
    /// </summary>
    public IDictionary<string, string>? Headers { get; init; }
}

/// <summary>
/// WebSocket transport connector for MCP servers.
/// </summary>
public class WebSocketConnector : IAsyncDisposable
{
    private readonly WebSocketConnectorOptions _options;
    private readonly ILogger<WebSocketConnector>? _logger;
    private ClientWebSocket? _webSocket;
    private CancellationTokenSource? _receiveCts;
    private Task? _receiveTask;
    private int _reconnectAttempts;
    private bool _isConnected;
    private bool _isDisposed;

    private readonly Dictionary<string, TaskCompletionSource<JsonElement>> _pendingRequests = new();
    private int _requestIdCounter;

    /// <summary>
    /// Event raised when connected.
    /// </summary>
    public event Func<Task>? OnConnected;

    /// <summary>
    /// Event raised when disconnected.
    /// </summary>
    public event Func<Exception?, Task>? OnDisconnected;

    /// <summary>
    /// Event raised when a message is received.
    /// </summary>
    public event Func<JsonElement, Task>? OnMessage;

    /// <summary>
    /// Event raised when an error occurs.
    /// </summary>
    public event Func<Exception, Task>? OnError;

    /// <summary>
    /// Gets whether the connector is currently connected.
    /// </summary>
    public bool IsConnected => _isConnected && _webSocket?.State == WebSocketState.Open;

    /// <summary>
    /// Creates a new WebSocket connector.
    /// </summary>
    public WebSocketConnector(WebSocketConnectorOptions options, ILogger<WebSocketConnector>? logger = null)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _logger = logger;
    }

    /// <summary>
    /// Connect to the WebSocket server.
    /// </summary>
    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        if (_isConnected)
        {
            _logger?.LogWarning("Already connected");
            return;
        }

        _webSocket = new ClientWebSocket();

        // Configure WebSocket options
        if (_options.KeepAliveIntervalMs > 0)
        {
            _webSocket.Options.KeepAliveInterval = TimeSpan.FromMilliseconds(_options.KeepAliveIntervalMs);
        }

        // Add authentication header if provided
        if (!string.IsNullOrEmpty(_options.AuthToken))
        {
            _webSocket.Options.SetRequestHeader("Authorization", $"Bearer {_options.AuthToken}");
        }

        // Add custom headers
        if (_options.Headers is not null)
        {
            foreach (var header in _options.Headers)
            {
                _webSocket.Options.SetRequestHeader(header.Key, header.Value);
            }
        }

        using var timeoutCts = new CancellationTokenSource(_options.ConnectionTimeoutMs);
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);

        try
        {
            _logger?.LogInformation("Connecting to WebSocket at {Uri}", _options.Uri);
            await _webSocket.ConnectAsync(_options.Uri, linkedCts.Token);

            _isConnected = true;
            _reconnectAttempts = 0;

            // Start receiving messages
            _receiveCts = new CancellationTokenSource();
            _receiveTask = ReceiveLoopAsync(_receiveCts.Token);

            _logger?.LogInformation("Connected to WebSocket");
            if (OnConnected is not null)
            {
                await OnConnected();
            }
        }
        catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
        {
            throw new TimeoutException($"Connection timed out after {_options.ConnectionTimeoutMs}ms");
        }
    }

    /// <summary>
    /// Disconnect from the WebSocket server.
    /// </summary>
    public async Task DisconnectAsync(CancellationToken cancellationToken = default)
    {
        if (!_isConnected || _webSocket is null)
        {
            return;
        }

        _isConnected = false;
        _receiveCts?.Cancel();

        try
        {
            if (_webSocket.State == WebSocketState.Open)
            {
                await _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Disconnect requested", cancellationToken);
            }
        }
        catch (Exception ex)
        {
            _logger?.LogWarning(ex, "Error during disconnect");
        }

        _webSocket.Dispose();
        _webSocket = null;

        if (OnDisconnected is not null)
        {
            await OnDisconnected(null);
        }

        _logger?.LogInformation("Disconnected from WebSocket");
    }

    /// <summary>
    /// Send a JSON-RPC request and wait for a response.
    /// </summary>
    public async Task<JsonElement> SendRequestAsync(
        string method,
        object? parameters = null,
        CancellationToken cancellationToken = default)
    {
        if (!IsConnected)
        {
            throw new InvalidOperationException("Not connected");
        }

        var requestId = Interlocked.Increment(ref _requestIdCounter).ToString();
        var request = new
        {
            jsonrpc = "2.0",
            id = requestId,
            method,
            @params = parameters
        };

        var tcs = new TaskCompletionSource<JsonElement>();
        _pendingRequests[requestId] = tcs;

        try
        {
            await SendMessageAsync(request, cancellationToken);

            // Wait for response with timeout
            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);

            linkedCts.Token.Register(() => tcs.TrySetCanceled());

            return await tcs.Task;
        }
        finally
        {
            _pendingRequests.Remove(requestId);
        }
    }

    /// <summary>
    /// Send a JSON-RPC notification (no response expected).
    /// </summary>
    public async Task SendNotificationAsync(
        string method,
        object? parameters = null,
        CancellationToken cancellationToken = default)
    {
        if (!IsConnected)
        {
            throw new InvalidOperationException("Not connected");
        }

        var notification = new
        {
            jsonrpc = "2.0",
            method,
            @params = parameters
        };

        await SendMessageAsync(notification, cancellationToken);
    }

    private async Task SendMessageAsync(object message, CancellationToken cancellationToken)
    {
        if (_webSocket is null || _webSocket.State != WebSocketState.Open)
        {
            throw new InvalidOperationException("WebSocket is not open");
        }

        var json = JsonSerializer.Serialize(message);
        var bytes = Encoding.UTF8.GetBytes(json);

        await _webSocket.SendAsync(
            new ArraySegment<byte>(bytes),
            WebSocketMessageType.Text,
            true,
            cancellationToken);

        _logger?.LogDebug("Sent: {Message}", json);
    }

    private async Task ReceiveLoopAsync(CancellationToken cancellationToken)
    {
        var buffer = new byte[_options.ReceiveBufferSize];
        var messageBuilder = new StringBuilder();

        try
        {
            while (!cancellationToken.IsCancellationRequested && _webSocket?.State == WebSocketState.Open)
            {
                try
                {
                    var result = await _webSocket.ReceiveAsync(
                        new ArraySegment<byte>(buffer),
                        cancellationToken);

                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        _logger?.LogInformation("Received close message");
                        await HandleDisconnectAsync(null);
                        return;
                    }

                    messageBuilder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));

                    if (result.EndOfMessage)
                    {
                        var message = messageBuilder.ToString();
                        messageBuilder.Clear();

                        _logger?.LogDebug("Received: {Message}", message);
                        await HandleMessageAsync(message);
                    }
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (WebSocketException ex)
                {
                    _logger?.LogError(ex, "WebSocket error");
                    await HandleDisconnectAsync(ex);
                    return;
                }
            }
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "Error in receive loop");
            if (OnError is not null)
            {
                await OnError(ex);
            }
        }
    }

    private async Task HandleMessageAsync(string message)
    {
        try
        {
            var json = JsonDocument.Parse(message);
            var root = json.RootElement;

            // Check if this is a response to a pending request
            if (root.TryGetProperty("id", out var idProp))
            {
                var requestId = idProp.GetString();
                if (requestId is not null && _pendingRequests.TryGetValue(requestId, out var tcs))
                {
                    if (root.TryGetProperty("error", out var errorProp))
                    {
                        var errorMessage = errorProp.TryGetProperty("message", out var msgProp)
                            ? msgProp.GetString() ?? "Unknown error"
                            : "Unknown error";
                        tcs.TrySetException(new JsonRpcException(errorMessage, errorProp));
                    }
                    else if (root.TryGetProperty("result", out var resultProp))
                    {
                        tcs.TrySetResult(resultProp);
                    }
                    else
                    {
                        tcs.TrySetResult(default);
                    }
                    return;
                }
            }

            // It's a notification or request from the server
            if (OnMessage is not null)
            {
                await OnMessage(root);
            }
        }
        catch (JsonException ex)
        {
            _logger?.LogWarning(ex, "Failed to parse message: {Message}", message);
        }
    }

    private async Task HandleDisconnectAsync(Exception? exception)
    {
        _isConnected = false;

        if (OnDisconnected is not null)
        {
            await OnDisconnected(exception);
        }

        // Fail all pending requests
        foreach (var pending in _pendingRequests.Values)
        {
            pending.TrySetException(exception ?? new InvalidOperationException("Disconnected"));
        }
        _pendingRequests.Clear();

        // Attempt reconnection if enabled
        if (_options.AutoReconnect && !_isDisposed)
        {
            await TryReconnectAsync();
        }
    }

    private async Task TryReconnectAsync()
    {
        while (_options.MaxReconnectAttempts == 0 || _reconnectAttempts < _options.MaxReconnectAttempts)
        {
            _reconnectAttempts++;
            _logger?.LogInformation("Attempting reconnection ({Attempt}/{Max})",
                _reconnectAttempts, _options.MaxReconnectAttempts == 0 ? "∞" : _options.MaxReconnectAttempts);

            try
            {
                await Task.Delay(_options.ReconnectDelayMs * _reconnectAttempts); // Exponential backoff
                await ConnectAsync();
                _logger?.LogInformation("Reconnection successful");
                return;
            }
            catch (Exception ex)
            {
                _logger?.LogWarning(ex, "Reconnection attempt {Attempt} failed", _reconnectAttempts);
            }
        }

        _logger?.LogError("Max reconnection attempts reached");
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        if (_isDisposed) return;
        _isDisposed = true;

        _receiveCts?.Cancel();

        if (_receiveTask is not null)
        {
            try
            {
                await _receiveTask;
            }
            catch { }
        }

        await DisconnectAsync();

        _receiveCts?.Dispose();
    }
}

/// <summary>
/// Exception for JSON-RPC errors.
/// </summary>
public class JsonRpcException : Exception
{
    /// <summary>
    /// The error object from the JSON-RPC response.
    /// </summary>
    public JsonElement ErrorObject { get; }

    public JsonRpcException(string message, JsonElement errorObject) : base(message)
    {
        ErrorObject = errorObject;
    }
}
