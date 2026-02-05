using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace McpUse.TaskManagers;

/// <summary>
/// Manages Streamable HTTP connections for MCP communication.
/// Supports bidirectional streaming over HTTP using chunked transfer encoding.
/// </summary>
public class StreamableHttpConnectionManager : IAsyncDisposable
{
    private readonly HttpClient _httpClient;
    private readonly string _endpoint;
    private readonly TimeSpan _timeout;
    private readonly JsonSerializerOptions _jsonOptions;

    private string? _sessionId;
    private bool _isConnected;

    /// <summary>
    /// Event raised when a message is received.
    /// </summary>
    public event EventHandler<StreamableHttpMessage>? MessageReceived;

    /// <summary>
    /// Event raised when an error occurs.
    /// </summary>
    public event EventHandler<Exception>? Error;

    /// <summary>
    /// Gets whether the connection is active.
    /// </summary>
    public bool IsConnected => _isConnected;

    /// <summary>
    /// Gets the current session ID.
    /// </summary>
    public string? SessionId => _sessionId;

    /// <summary>
    /// Creates a new Streamable HTTP connection manager.
    /// </summary>
    /// <param name="httpClient">HTTP client to use.</param>
    /// <param name="endpoint">HTTP endpoint URL.</param>
    /// <param name="timeout">Request timeout (default: 30 seconds).</param>
    public StreamableHttpConnectionManager(
        HttpClient httpClient,
        string endpoint,
        TimeSpan? timeout = null)
    {
        _httpClient = httpClient;
        _endpoint = endpoint;
        _timeout = timeout ?? TimeSpan.FromSeconds(30);
        _jsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            PropertyNameCaseInsensitive = true
        };
    }

    /// <summary>
    /// Initializes the connection.
    /// </summary>
    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        if (_isConnected)
            return;

        // Send an initialize request to get session ID
        var initRequest = new
        {
            jsonrpc = "2.0",
            method = "initialize",
            @params = new
            {
                protocolVersion = "2024-11-05",
                capabilities = new { },
                clientInfo = new { name = "mcp-use-csharp", version = "1.0.0" }
            },
            id = Guid.NewGuid().ToString()
        };

        _ = await SendAsync(initRequest, cancellationToken);
        _isConnected = true;
    }

    /// <summary>
    /// Sends a request and returns the response.
    /// </summary>
    public async Task<JsonDocument> SendAsync(object request, CancellationToken cancellationToken = default)
    {
        var json = JsonSerializer.Serialize(request, _jsonOptions);
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        // Add session ID if we have one
        if (_sessionId != null)
        {
            content.Headers.Add("Mcp-Session-Id", _sessionId);
        }

        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, _endpoint);
        httpRequest.Content = content;
        httpRequest.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        httpRequest.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));

        using var cts = new CancellationTokenSource(_timeout);
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, cts.Token);

        using var response = await _httpClient.SendAsync(
            httpRequest,
            HttpCompletionOption.ResponseHeadersRead,
            linkedCts.Token);

        // Store session ID from response
        if (response.Headers.TryGetValues("Mcp-Session-Id", out var sessionIds))
        {
            _sessionId = sessionIds.FirstOrDefault();
        }

        response.EnsureSuccessStatusCode();

        var contentType = response.Content.Headers.ContentType?.MediaType;

        if (contentType == "text/event-stream")
        {
            // Process SSE response
            return await ProcessSseResponseAsync(response, linkedCts.Token);
        }
        else
        {
            // Standard JSON response
            var responseJson = await response.Content.ReadAsStringAsync(linkedCts.Token);
            return JsonDocument.Parse(responseJson);
        }
    }

    /// <summary>
    /// Sends a request and streams the response.
    /// </summary>
    public async IAsyncEnumerable<JsonDocument> StreamAsync(
        object request,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var json = JsonSerializer.Serialize(request, _jsonOptions);
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        if (_sessionId != null)
        {
            content.Headers.Add("Mcp-Session-Id", _sessionId);
        }

        using var httpRequest = new HttpRequestMessage(HttpMethod.Post, _endpoint);
        httpRequest.Content = content;
        httpRequest.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));

        using var response = await _httpClient.SendAsync(
            httpRequest,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);

        if (response.Headers.TryGetValues("Mcp-Session-Id", out var sessionIds))
        {
            _sessionId = sessionIds.FirstOrDefault();
        }

        response.EnsureSuccessStatusCode();

        using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var reader = new StreamReader(stream);

        var eventData = new StringBuilder();

        while (!cancellationToken.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(cancellationToken);
            if (line == null) break;

            if (line.StartsWith("data:"))
            {
                eventData.Append(line[5..].Trim());
            }
            else if (string.IsNullOrEmpty(line) && eventData.Length > 0)
            {
                var data = eventData.ToString();
                eventData.Clear();

                if (!string.IsNullOrEmpty(data) && data != "[DONE]")
                {
                    JsonDocument doc;
                    try
                    {
                        doc = JsonDocument.Parse(data);
                    }
                    catch (JsonException ex)
                    {
                        Error?.Invoke(this, ex);
                        continue;
                    }

                    var message = new StreamableHttpMessage
                    {
                        Data = doc
                    };
                    MessageReceived?.Invoke(this, message);

                    yield return doc;
                }
            }
        }
    }

    private async Task<JsonDocument> ProcessSseResponseAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var reader = new StreamReader(stream);

        var eventData = new StringBuilder();
        JsonDocument? lastDoc = null;

        while (!cancellationToken.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(cancellationToken);
            if (line == null) break;

            if (line.StartsWith("data:"))
            {
                eventData.Append(line[5..].Trim());
            }
            else if (string.IsNullOrEmpty(line) && eventData.Length > 0)
            {
                var data = eventData.ToString();
                eventData.Clear();

                if (!string.IsNullOrEmpty(data) && data != "[DONE]")
                {
                    try
                    {
                        lastDoc?.Dispose();
                        lastDoc = JsonDocument.Parse(data);

                        var message = new StreamableHttpMessage { Data = lastDoc };
                        MessageReceived?.Invoke(this, message);
                    }
                    catch { }
                }
            }
        }

        return lastDoc ?? JsonDocument.Parse("{}");
    }

    /// <summary>
    /// Disconnects the connection.
    /// </summary>
    public Task DisconnectAsync()
    {
        _isConnected = false;
        _sessionId = null;
        return Task.CompletedTask;
    }

    public async ValueTask DisposeAsync()
    {
        await DisconnectAsync();
    }
}

/// <summary>
/// Streamable HTTP message.
/// </summary>
public class StreamableHttpMessage
{
    /// <summary>
    /// Message data as JSON document.
    /// </summary>
    public JsonDocument? Data { get; set; }
}
