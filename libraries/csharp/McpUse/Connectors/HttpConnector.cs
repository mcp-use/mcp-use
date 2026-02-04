using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Collections.Concurrent;

namespace McpUse.Connectors;

/// <summary>
/// Connector for MCP servers using HTTP transport with Server-Sent Events (SSE).
/// Supports both SSE and Streamable HTTP protocols.
/// </summary>
public class HttpConnector : IConnector
{
    private readonly string _baseUrl;
    private readonly Dictionary<string, string> _headers;
    private readonly TimeSpan _timeout;
    private readonly TimeSpan _sseReadTimeout;
    private readonly IHttpAuth? _auth;
    private readonly bool _verifySsl;

    private HttpClient? _httpClient;
    private CancellationTokenSource? _sseCts;
    private Task? _sseTask;
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonRpcResponse>> _pendingRequests = new();
    private readonly JsonSerializerOptions _jsonOptions;
    private string? _sessionId;
    private bool _isConnected;

    public string Name => "http";
    public bool IsConnected => _isConnected;

    public event EventHandler<JsonRpcNotification>? NotificationReceived;
    public event EventHandler<Exception?>? Disconnected;

    /// <summary>
    /// Creates a new HTTP connector.
    /// </summary>
    /// <param name="baseUrl">Base URL of the MCP HTTP API.</param>
    /// <param name="headers">Optional additional headers.</param>
    /// <param name="timeout">Timeout for HTTP operations (default: 5 seconds).</param>
    /// <param name="sseReadTimeout">Timeout for SSE read operations (default: 5 minutes).</param>
    /// <param name="auth">Optional authentication provider.</param>
    /// <param name="verifySsl">Whether to verify SSL certificates (default: true).</param>
    public HttpConnector(
        string baseUrl,
        Dictionary<string, string>? headers = null,
        TimeSpan? timeout = null,
        TimeSpan? sseReadTimeout = null,
        IHttpAuth? auth = null,
        bool verifySsl = true)
    {
        ArgumentNullException.ThrowIfNull(baseUrl);
        _baseUrl = baseUrl.TrimEnd('/');
        _headers = headers ?? new Dictionary<string, string>();
        _timeout = timeout ?? TimeSpan.FromSeconds(5);
        _sseReadTimeout = sseReadTimeout ?? TimeSpan.FromMinutes(5);
        _auth = auth;
        _verifySsl = verifySsl;

        _jsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true
        };
    }

    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        if (_isConnected)
            return;

        var handler = new HttpClientHandler();
        if (!_verifySsl)
        {
            handler.ServerCertificateCustomValidationCallback = (_, _, _, _) => true;
        }

        _httpClient = new HttpClient(handler)
        {
            BaseAddress = new Uri(_baseUrl),
            Timeout = _timeout
        };

        // Set default headers
        foreach (var (key, value) in _headers)
        {
            _httpClient.DefaultRequestHeaders.TryAddWithoutValidation(key, value);
        }

        // Apply authentication
        if (_auth != null)
        {
            await _auth.ApplyAsync(_httpClient, cancellationToken);
        }

        // Try to establish SSE connection for server notifications
        _sseCts = new CancellationTokenSource();
        _sseTask = StartSseConnectionAsync(_sseCts.Token);

        _isConnected = true;
    }

    public async Task DisconnectAsync(CancellationToken cancellationToken = default)
    {
        _isConnected = false;
        _sseCts?.Cancel();

        if (_sseTask != null)
        {
            try
            {
                await _sseTask;
            }
            catch (OperationCanceledException) { }
        }

        _httpClient?.Dispose();
        _httpClient = null;

        foreach (var pending in _pendingRequests.Values)
        {
            pending.TrySetCanceled();
        }
        _pendingRequests.Clear();
    }

    public async Task<JsonRpcResponse> SendRequestAsync(JsonRpcRequest request, CancellationToken cancellationToken = default)
    {
        if (_httpClient == null)
            throw new McpConnectionException("Not connected");

        var json = JsonSerializer.Serialize(request, _jsonOptions);
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        // Add session ID if we have one
        if (_sessionId != null)
        {
            content.Headers.Add("X-MCP-Session-Id", _sessionId);
        }

        var response = await _httpClient.PostAsync("/", content, cancellationToken);

        // Store session ID from response
        if (response.Headers.TryGetValues("X-MCP-Session-Id", out var sessionIds))
        {
            _sessionId = sessionIds.FirstOrDefault();
        }

        response.EnsureSuccessStatusCode();

        var responseJson = await response.Content.ReadAsStringAsync(cancellationToken);
        return JsonSerializer.Deserialize<JsonRpcResponse>(responseJson, _jsonOptions)!;
    }

    public async Task SendNotificationAsync(JsonRpcNotification notification, CancellationToken cancellationToken = default)
    {
        if (_httpClient == null)
            throw new McpConnectionException("Not connected");

        var json = JsonSerializer.Serialize(notification, _jsonOptions);
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        if (_sessionId != null)
        {
            content.Headers.Add("X-MCP-Session-Id", _sessionId);
        }

        await _httpClient.PostAsync("/", content, cancellationToken);
    }

    private async Task StartSseConnectionAsync(CancellationToken cancellationToken)
    {
        if (_httpClient == null) return;

        try
        {
            var request = new HttpRequestMessage(HttpMethod.Get, "/sse");
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));

            if (_sessionId != null)
            {
                request.Headers.Add("X-MCP-Session-Id", _sessionId);
            }

            using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);

            if (!response.IsSuccessStatusCode)
                return;

            using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var reader = new StreamReader(stream);

            var eventData = new StringBuilder();
            var eventType = "message";

            while (!cancellationToken.IsCancellationRequested)
            {
                var line = await reader.ReadLineAsync(cancellationToken);
                if (line == null) break;

                if (line.StartsWith("event:"))
                {
                    eventType = line[6..].Trim();
                }
                else if (line.StartsWith("data:"))
                {
                    eventData.Append(line[5..].Trim());
                }
                else if (string.IsNullOrEmpty(line) && eventData.Length > 0)
                {
                    // End of event
                    ProcessSseEvent(eventType, eventData.ToString());
                    eventData.Clear();
                    eventType = "message";
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            if (_isConnected)
            {
                Disconnected?.Invoke(this, ex);
            }
        }
    }

    private void ProcessSseEvent(string eventType, string data)
    {
        try
        {
            using var doc = JsonDocument.Parse(data);
            var root = doc.RootElement;

            if (root.TryGetProperty("id", out var idElement) && idElement.ValueKind != JsonValueKind.Null)
            {
                // Response
                var id = idElement.GetString() ?? idElement.GetRawText();
                var response = JsonSerializer.Deserialize<JsonRpcResponse>(data, _jsonOptions)!;

                if (_pendingRequests.TryRemove(id, out var tcs))
                {
                    tcs.TrySetResult(response);
                }
            }
            else
            {
                // Notification
                var notification = JsonSerializer.Deserialize<JsonRpcNotification>(data, _jsonOptions)!;
                NotificationReceived?.Invoke(this, notification);
            }
        }
        catch (JsonException)
        {
            // Skip malformed JSON
        }
    }

    public async ValueTask DisposeAsync()
    {
        await DisconnectAsync();
        GC.SuppressFinalize(this);
    }
}

/// <summary>
/// Interface for HTTP authentication providers.
/// </summary>
public interface IHttpAuth
{
    /// <summary>
    /// Applies authentication to the HTTP client.
    /// </summary>
    Task ApplyAsync(HttpClient client, CancellationToken cancellationToken = default);
}

/// <summary>
/// Bearer token authentication.
/// </summary>
public class BearerAuth : IHttpAuth
{
    private readonly string _token;

    public BearerAuth(string token)
    {
        _token = token ?? throw new ArgumentNullException(nameof(token));
    }

    public Task ApplyAsync(HttpClient client, CancellationToken cancellationToken = default)
    {
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", _token);
        return Task.CompletedTask;
    }
}
