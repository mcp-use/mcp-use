namespace McpUse.Connectors;

/// <summary>
/// Base interface for MCP connectors.
/// Connectors handle the transport layer for MCP communication.
/// </summary>
public interface IConnector : IAsyncDisposable
{
    /// <summary>
    /// Gets the name of this connector type.
    /// </summary>
    string Name { get; }

    /// <summary>
    /// Gets whether the connector is currently connected.
    /// </summary>
    bool IsConnected { get; }

    /// <summary>
    /// Connects to the MCP server.
    /// </summary>
    Task ConnectAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Disconnects from the MCP server.
    /// </summary>
    Task DisconnectAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Sends a JSON-RPC request and returns the response.
    /// </summary>
    Task<JsonRpcResponse> SendRequestAsync(JsonRpcRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// Sends a JSON-RPC notification (no response expected).
    /// </summary>
    Task SendNotificationAsync(JsonRpcNotification notification, CancellationToken cancellationToken = default);

    /// <summary>
    /// Event raised when a notification is received from the server.
    /// </summary>
    event EventHandler<JsonRpcNotification>? NotificationReceived;

    /// <summary>
    /// Event raised when the connection is lost.
    /// </summary>
    event EventHandler<Exception?>? Disconnected;
}

/// <summary>
/// JSON-RPC 2.0 request message.
/// </summary>
public class JsonRpcRequest
{
    public string JsonRpc { get; set; } = "2.0";
    public string Method { get; set; } = string.Empty;
    public object? Params { get; set; }
    public string Id { get; set; } = Guid.NewGuid().ToString();
}

/// <summary>
/// JSON-RPC 2.0 response message.
/// </summary>
public class JsonRpcResponse
{
    public string JsonRpc { get; set; } = "2.0";
    public object? Result { get; set; }
    public JsonRpcError? Error { get; set; }
    public string? Id { get; set; }

    public bool IsSuccess => Error == null;
}

/// <summary>
/// JSON-RPC 2.0 error object.
/// </summary>
public class JsonRpcError
{
    public int Code { get; set; }
    public string Message { get; set; } = string.Empty;
    public object? Data { get; set; }
}

/// <summary>
/// JSON-RPC 2.0 notification message (no id, no response expected).
/// </summary>
public class JsonRpcNotification
{
    public string JsonRpc { get; set; } = "2.0";
    public string Method { get; set; } = string.Empty;
    public object? Params { get; set; }
}
