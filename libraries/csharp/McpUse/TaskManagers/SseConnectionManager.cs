using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace McpUse.TaskManagers;

/// <summary>
/// Manages SSE (Server-Sent Events) connections for MCP communication.
/// </summary>
public class SseConnectionManager : IAsyncDisposable
{
    private readonly HttpClient _httpClient;
    private readonly string _endpoint;
    private readonly TimeSpan _readTimeout;
    private readonly JsonSerializerOptions _jsonOptions;

    private CancellationTokenSource? _cts;
    private Task? _connectionTask;
    private bool _isConnected;

    /// <summary>
    /// Event raised when a message is received.
    /// </summary>
    public event EventHandler<SseMessage>? MessageReceived;

    /// <summary>
    /// Event raised when an error occurs.
    /// </summary>
    public event EventHandler<Exception>? Error;

    /// <summary>
    /// Event raised when the connection is closed.
    /// </summary>
    public event EventHandler? Closed;

    /// <summary>
    /// Gets whether the connection is active.
    /// </summary>
    public bool IsConnected => _isConnected;

    /// <summary>
    /// Creates a new SSE connection manager.
    /// </summary>
    /// <param name="httpClient">HTTP client to use for connections.</param>
    /// <param name="endpoint">SSE endpoint URL.</param>
    /// <param name="readTimeout">Read timeout (default: 5 minutes).</param>
    public SseConnectionManager(
        HttpClient httpClient,
        string endpoint,
        TimeSpan? readTimeout = null)
    {
        _httpClient = httpClient;
        _endpoint = endpoint;
        _readTimeout = readTimeout ?? TimeSpan.FromMinutes(5);
        _jsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true
        };
    }

    /// <summary>
    /// Starts the SSE connection.
    /// </summary>
    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        if (_isConnected)
            return;

        _cts = new CancellationTokenSource();
        _connectionTask = RunConnectionAsync(_cts.Token);
        _isConnected = true;

        // Wait a bit to ensure connection is established
        await Task.Delay(100, cancellationToken);
    }

    /// <summary>
    /// Stops the SSE connection.
    /// </summary>
    public async Task DisconnectAsync()
    {
        _isConnected = false;
        _cts?.Cancel();

        if (_connectionTask != null)
        {
            try
            {
                await _connectionTask;
            }
            catch (OperationCanceledException) { }
        }

        _cts?.Dispose();
        _cts = null;
    }

    private async Task RunConnectionAsync(CancellationToken cancellationToken)
    {
        var retryCount = 0;
        var maxRetries = 5;
        var retryDelay = TimeSpan.FromSeconds(1);

        while (!cancellationToken.IsCancellationRequested && retryCount < maxRetries)
        {
            try
            {
                await ProcessSseStreamAsync(cancellationToken);

                // If we get here normally, connection was closed gracefully
                break;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                retryCount++;
                Error?.Invoke(this, ex);

                if (retryCount < maxRetries)
                {
                    await Task.Delay(retryDelay * retryCount, cancellationToken);
                }
            }
        }

        _isConnected = false;
        Closed?.Invoke(this, EventArgs.Empty);
    }

    private async Task ProcessSseStreamAsync(CancellationToken cancellationToken)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, _endpoint);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));

        using var timeoutCts = new CancellationTokenSource(_readTimeout);
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);

        using var response = await _httpClient.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            linkedCts.Token);

        response.EnsureSuccessStatusCode();

        using var stream = await response.Content.ReadAsStreamAsync(linkedCts.Token);
        using var reader = new StreamReader(stream);

        var eventData = new StringBuilder();
        var eventType = "message";
        var eventId = (string?)null;

        while (!linkedCts.Token.IsCancellationRequested)
        {
            // Reset timeout for each read
            timeoutCts.CancelAfter(_readTimeout);

            var line = await reader.ReadLineAsync(linkedCts.Token);
            if (line == null) break; // EOF

            if (line.StartsWith("event:"))
            {
                eventType = line[6..].Trim();
            }
            else if (line.StartsWith("data:"))
            {
                if (eventData.Length > 0)
                    eventData.AppendLine();
                eventData.Append(line[5..].Trim());
            }
            else if (line.StartsWith("id:"))
            {
                eventId = line[3..].Trim();
            }
            else if (string.IsNullOrEmpty(line) && eventData.Length > 0)
            {
                // End of event, dispatch it
                var message = new SseMessage
                {
                    EventType = eventType,
                    Data = eventData.ToString(),
                    Id = eventId
                };

                MessageReceived?.Invoke(this, message);

                // Reset for next event
                eventData.Clear();
                eventType = "message";
                eventId = null;
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        await DisconnectAsync();
    }
}

/// <summary>
/// SSE message data.
/// </summary>
public class SseMessage
{
    /// <summary>
    /// Event type.
    /// </summary>
    public string EventType { get; set; } = "message";

    /// <summary>
    /// Event data.
    /// </summary>
    public string Data { get; set; } = string.Empty;

    /// <summary>
    /// Event ID (optional).
    /// </summary>
    public string? Id { get; set; }

    /// <summary>
    /// Parses the data as JSON.
    /// </summary>
    public T? ParseJson<T>()
    {
        if (string.IsNullOrEmpty(Data))
            return default;

        return JsonSerializer.Deserialize<T>(Data, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });
    }
}
