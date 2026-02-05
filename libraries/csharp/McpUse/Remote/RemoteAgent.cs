using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using McpUse.Agent;

namespace McpUse.Remote;

/// <summary>
/// Remote agent implementation for executing agents via API.
/// Connects to the mcp-use.com cloud service for remote agent execution.
/// </summary>
public class RemoteAgent : IAsyncDisposable
{
    private readonly string _agentId;
    private readonly string _apiKey;
    private readonly string _baseUrl;
    private readonly HttpClient _httpClient;
    private readonly ILogger<RemoteAgent>? _logger;
    private string? _chatId;

    private const string ApiChatsEndpoint = "/api/v1/chats";
    private const string ApiChatExecuteEndpoint = "/api/v1/chats/{0}/execute";

    /// <summary>
    /// Creates a new RemoteAgent instance.
    /// </summary>
    /// <param name="agentId">The ID of the remote agent to use.</param>
    /// <param name="apiKey">API key for authentication. If not provided, reads from MCP_USE_API_KEY environment variable.</param>
    /// <param name="baseUrl">Base URL for the remote service. Defaults to https://cloud.mcp-use.com</param>
    /// <param name="logger">Optional logger.</param>
    /// <exception cref="ArgumentException">Thrown when no API key is provided or found in environment.</exception>
    public RemoteAgent(
        string agentId,
        string? apiKey = null,
        string? baseUrl = null,
        ILogger<RemoteAgent>? logger = null)
    {
        _agentId = agentId ?? throw new ArgumentNullException(nameof(agentId));
        _baseUrl = baseUrl ?? "https://cloud.mcp-use.com";
        _logger = logger;

        _apiKey = apiKey ?? Environment.GetEnvironmentVariable("MCP_USE_API_KEY")
            ?? throw new ArgumentException(
                "API key is required for remote execution. " +
                "Please provide it as a parameter or set the MCP_USE_API_KEY environment variable. " +
                "You can get an API key from https://cloud.mcp-use.com");

        _httpClient = new HttpClient
        {
            BaseAddress = new Uri(_baseUrl)
        };
        _httpClient.DefaultRequestHeaders.Add("x-api-key", _apiKey);
        _httpClient.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    }

    /// <summary>
    /// Runs the remote agent with the given query.
    /// </summary>
    /// <param name="query">The user query to process.</param>
    /// <param name="maxSteps">Maximum number of steps (optional).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The agent's response as a string.</returns>
    public async Task<string> RunAsync(
        string query,
        int? maxSteps = null,
        CancellationToken cancellationToken = default)
    {
        // Create chat session if needed
        if (_chatId is null)
        {
            _chatId = await CreateChatSessionAsync(cancellationToken);
        }

        // Execute the query
        var request = new RemoteExecuteRequest
        {
            Query = query,
            MaxSteps = maxSteps
        };

        var executeUrl = string.Format(ApiChatExecuteEndpoint, _chatId);
        _logger?.LogInformation("Executing remote agent query: {Query}", query);

        var response = await _httpClient.PostAsJsonAsync(executeUrl, request, cancellationToken);
        await EnsureSuccessStatusCodeAsync(response, "execute agent");

        var result = await response.Content.ReadFromJsonAsync<RemoteExecuteResponse>(cancellationToken: cancellationToken);
        return result?.Result ?? "";
    }

    /// <summary>
    /// Runs the remote agent with structured output.
    /// </summary>
    /// <typeparam name="T">The type to deserialize the response to.</typeparam>
    /// <param name="query">The user query to process.</param>
    /// <param name="maxSteps">Maximum number of steps (optional).</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The agent's response deserialized to the specified type.</returns>
    public async Task<T?> RunAsync<T>(
        string query,
        int? maxSteps = null,
        CancellationToken cancellationToken = default)
    {
        var result = await RunAsync(query, maxSteps, cancellationToken);

        try
        {
            return JsonSerializer.Deserialize<T>(result, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
        }
        catch (JsonException ex)
        {
            _logger?.LogWarning(ex, "Failed to parse structured output, returning raw result");
            throw;
        }
    }

    /// <summary>
    /// Runs the remote agent with options.
    /// </summary>
    /// <param name="options">The run options.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The agent's response as a string.</returns>
    public async Task<string> RunAsync(
        RemoteRunOptions options,
        CancellationToken cancellationToken = default)
    {
        return await RunAsync(options.Query, options.MaxSteps, cancellationToken);
    }

    /// <summary>
    /// Closes the remote agent session.
    /// </summary>
    public async Task CloseAsync(CancellationToken cancellationToken = default)
    {
        if (_chatId is not null)
        {
            try
            {
                // Optionally close the chat session on the server
                _logger?.LogInformation("Closing remote agent session: {ChatId}", _chatId);
                _chatId = null;
            }
            catch (Exception ex)
            {
                _logger?.LogWarning(ex, "Error closing remote agent session");
            }
        }
    }

    private async Task<string> CreateChatSessionAsync(CancellationToken cancellationToken)
    {
        var chatPayload = new CreateChatRequest
        {
            Title = $"Remote Agent Session - {_agentId}",
            AgentId = _agentId,
            Type = "agent_execution"
        };

        _logger?.LogInformation("Creating chat session for agent {AgentId}", _agentId);

        var response = await _httpClient.PostAsJsonAsync(ApiChatsEndpoint, chatPayload, cancellationToken);

        if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            throw new RemoteAgentException(
                $"Agent not found: Agent '{_agentId}' does not exist or you don't have access to it. " +
                "Please verify the agent ID and ensure it exists in your account.",
                System.Net.HttpStatusCode.NotFound);
        }

        await EnsureSuccessStatusCodeAsync(response, "create chat session");

        var chatData = await response.Content.ReadFromJsonAsync<CreateChatResponse>(cancellationToken: cancellationToken);
        var chatId = chatData?.Id ?? throw new RemoteAgentException("Failed to get chat ID from response");

        _logger?.LogInformation("Chat session created: {ChatId}", chatId);
        return chatId;
    }

    private async Task EnsureSuccessStatusCodeAsync(HttpResponseMessage response, string operation)
    {
        if (!response.IsSuccessStatusCode)
        {
            var responseText = await response.Content.ReadAsStringAsync();
            throw new RemoteAgentException(
                $"Failed to {operation}: {(int)response.StatusCode} - {responseText}",
                response.StatusCode);
        }
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        await CloseAsync();
        _httpClient.Dispose();
    }
}

/// <summary>
/// Options for running a remote agent.
/// </summary>
public class RemoteRunOptions
{
    /// <summary>
    /// The query to send to the agent.
    /// </summary>
    public required string Query { get; init; }

    /// <summary>
    /// Maximum number of steps the agent can take.
    /// </summary>
    public int? MaxSteps { get; init; }

    /// <summary>
    /// External conversation history to include.
    /// </summary>
    public IList<Microsoft.Extensions.AI.ChatMessage>? ExternalHistory { get; init; }
}

/// <summary>
/// Exception thrown when a remote agent operation fails.
/// </summary>
public class RemoteAgentException : Exception
{
    /// <summary>
    /// The HTTP status code, if available.
    /// </summary>
    public System.Net.HttpStatusCode? StatusCode { get; }

    public RemoteAgentException(string message, System.Net.HttpStatusCode? statusCode = null)
        : base(message)
    {
        StatusCode = statusCode;
    }
}

// Internal DTOs for API communication

internal class CreateChatRequest
{
    [JsonPropertyName("title")]
    public required string Title { get; init; }

    [JsonPropertyName("agent_id")]
    public required string AgentId { get; init; }

    [JsonPropertyName("type")]
    public required string Type { get; init; }
}

internal class CreateChatResponse
{
    [JsonPropertyName("id")]
    public string? Id { get; init; }
}

internal class RemoteExecuteRequest
{
    [JsonPropertyName("query")]
    public required string Query { get; init; }

    [JsonPropertyName("max_steps")]
    public int? MaxSteps { get; init; }

    [JsonPropertyName("output_schema")]
    public object? OutputSchema { get; init; }
}

internal class RemoteExecuteResponse
{
    [JsonPropertyName("result")]
    public string? Result { get; init; }

    [JsonPropertyName("status")]
    public string? Status { get; init; }

    [JsonPropertyName("error")]
    public string? Error { get; init; }
}
