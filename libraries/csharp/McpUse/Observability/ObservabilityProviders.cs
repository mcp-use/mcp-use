using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace McpUse.Observability;

/// <summary>
/// Langfuse observability callback for LLM tracing.
/// See: https://langfuse.com
/// </summary>
public class LangfuseCallback : IObservabilityCallback
{
    private readonly HttpClient _httpClient;
    private readonly string _publicKey;
    private readonly string _secretKey;
    private readonly string _baseUrl;
    private readonly JsonSerializerOptions _jsonOptions;

    private readonly Dictionary<string, LangfuseTrace> _activeTraces = new();

    /// <summary>
    /// Creates a new Langfuse callback.
    /// </summary>
    /// <param name="publicKey">Langfuse public key.</param>
    /// <param name="secretKey">Langfuse secret key.</param>
    /// <param name="baseUrl">Langfuse API URL (default: https://cloud.langfuse.com).</param>
    public LangfuseCallback(
        string? publicKey = null,
        string? secretKey = null,
        string? baseUrl = null)
    {
        _publicKey = publicKey ?? Environment.GetEnvironmentVariable("LANGFUSE_PUBLIC_KEY")
            ?? throw new ArgumentException("Langfuse public key is required");
        _secretKey = secretKey ?? Environment.GetEnvironmentVariable("LANGFUSE_SECRET_KEY")
            ?? throw new ArgumentException("Langfuse secret key is required");
        _baseUrl = (baseUrl ?? Environment.GetEnvironmentVariable("LANGFUSE_HOST") ?? "https://cloud.langfuse.com").TrimEnd('/');

        _httpClient = new HttpClient();
        var credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{_publicKey}:{_secretKey}"));
        _httpClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", credentials);
        _httpClient.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        _jsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
        };
    }

    public async Task OnRunStartAsync(RunContext context, CancellationToken cancellationToken = default)
    {
        var trace = new LangfuseTrace
        {
            Id = context.RunId,
            Name = "mcp-agent-run",
            Input = context.Query,
            Metadata = context.Metadata,
            Timestamp = context.StartTime
        };

        _activeTraces[context.RunId] = trace;

        await SendEventAsync("trace-create", new
        {
            id = trace.Id,
            name = trace.Name,
            input = trace.Input,
            metadata = trace.Metadata,
            timestamp = trace.Timestamp
        }, cancellationToken);
    }

    public async Task OnRunEndAsync(RunContext context, RunResult result, CancellationToken cancellationToken = default)
    {
        if (!_activeTraces.TryGetValue(context.RunId, out var trace))
            return;

        await SendEventAsync("trace-create", new
        {
            id = trace.Id,
            output = result.Output,
            level = result.Success ? "DEFAULT" : "ERROR",
            statusMessage = result.Error,
            metadata = new
            {
                totalSteps = result.TotalSteps,
                totalToolCalls = result.TotalToolCalls,
                durationMs = result.Duration.TotalMilliseconds
            }
        }, cancellationToken);

        _activeTraces.Remove(context.RunId);
    }

    public async Task OnStepStartAsync(StepContext context, CancellationToken cancellationToken = default)
    {
        await SendEventAsync("span-create", new
        {
            id = $"{context.RunId}-step-{context.StepNumber}",
            traceId = context.RunId,
            name = $"step-{context.StepNumber}",
            startTime = context.StartTime
        }, cancellationToken);
    }

    public async Task OnStepEndAsync(StepContext context, StepResult result, CancellationToken cancellationToken = default)
    {
        await SendEventAsync("span-update", new
        {
            id = $"{context.RunId}-step-{context.StepNumber}",
            endTime = DateTimeOffset.UtcNow,
            output = result.Output,
            metadata = new
            {
                hasToolCall = result.HasToolCall,
                toolName = result.ToolName,
                durationMs = result.Duration.TotalMilliseconds
            }
        }, cancellationToken);
    }

    public async Task OnToolCallAsync(ToolCallContext context, CancellationToken cancellationToken = default)
    {
        await SendEventAsync("span-create", new
        {
            id = $"{context.RunId}-tool-{context.StepNumber}-{context.ToolName}",
            traceId = context.RunId,
            parentObservationId = $"{context.RunId}-step-{context.StepNumber}",
            name = context.ToolName,
            input = context.Arguments,
            startTime = context.StartTime,
            metadata = new { type = "tool-call" }
        }, cancellationToken);
    }

    public async Task OnToolResultAsync(ToolCallContext context, ToolCallResult result, CancellationToken cancellationToken = default)
    {
        await SendEventAsync("span-update", new
        {
            id = $"{context.RunId}-tool-{context.StepNumber}-{context.ToolName}",
            endTime = DateTimeOffset.UtcNow,
            output = result.Output,
            level = result.Success ? "DEFAULT" : "ERROR",
            statusMessage = result.Error
        }, cancellationToken);
    }

    public async Task OnLlmCallAsync(LlmCallContext context, CancellationToken cancellationToken = default)
    {
        await SendEventAsync("generation-create", new
        {
            id = $"{context.RunId}-llm-{context.StepNumber}",
            traceId = context.RunId,
            parentObservationId = $"{context.RunId}-step-{context.StepNumber}",
            name = "llm-call",
            model = context.Model,
            startTime = context.StartTime,
            usage = new { input = context.InputTokens }
        }, cancellationToken);
    }

    public async Task OnLlmResultAsync(LlmCallContext context, LlmResult result, CancellationToken cancellationToken = default)
    {
        await SendEventAsync("generation-update", new
        {
            id = $"{context.RunId}-llm-{context.StepNumber}",
            endTime = DateTimeOffset.UtcNow,
            usage = new { output = result.OutputTokens },
            completionStartTime = context.StartTime.Add(result.Duration),
            level = result.Success ? "DEFAULT" : "ERROR"
        }, cancellationToken);
    }

    public async Task OnErrorAsync(ErrorContext context, CancellationToken cancellationToken = default)
    {
        await SendEventAsync("event-create", new
        {
            traceId = context.RunId,
            name = "error",
            level = "ERROR",
            statusMessage = context.Exception.Message,
            timestamp = context.Timestamp,
            metadata = new
            {
                exceptionType = context.Exception.GetType().Name,
                toolName = context.ToolName,
                stepNumber = context.StepNumber
            }
        }, cancellationToken);
    }

    private async Task SendEventAsync(string eventType, object data, CancellationToken cancellationToken)
    {
        try
        {
            var batch = new
            {
                batch = new[]
                {
                    new
                    {
                        id = Guid.NewGuid().ToString(),
                        type = eventType,
                        timestamp = DateTimeOffset.UtcNow,
                        body = data
                    }
                }
            };

            var json = JsonSerializer.Serialize(batch, _jsonOptions);
            using var content = new StringContent(json, Encoding.UTF8, "application/json");

            await _httpClient.PostAsync($"{_baseUrl}/api/public/ingestion", content, cancellationToken);
        }
        catch
        {
            // Silently ignore errors to not disrupt the main flow
        }
    }

    private class LangfuseTrace
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string? Input { get; set; }
        public Dictionary<string, object>? Metadata { get; set; }
        public DateTimeOffset Timestamp { get; set; }
    }
}

/// <summary>
/// Laminar observability callback.
/// See: https://www.lmnr.ai
/// </summary>
public class LaminarCallback : IObservabilityCallback
{
    private readonly HttpClient _httpClient;
    private readonly string _apiKey;
    private readonly string _baseUrl;
    private readonly string _projectName;
    private readonly JsonSerializerOptions _jsonOptions;

    public LaminarCallback(
        string? apiKey = null,
        string? baseUrl = null,
        string? projectName = null)
    {
        _apiKey = apiKey ?? Environment.GetEnvironmentVariable("LAMINAR_API_KEY")
            ?? throw new ArgumentException("Laminar API key is required");
        _baseUrl = (baseUrl ?? "https://api.lmnr.ai").TrimEnd('/');
        _projectName = projectName ?? Environment.GetEnvironmentVariable("LAMINAR_PROJECT") ?? "mcp-use";

        _httpClient = new HttpClient();
        _httpClient.DefaultRequestHeaders.Add("Authorization", $"Bearer {_apiKey}");

        _jsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };
    }

    public async Task OnRunStartAsync(RunContext context, CancellationToken cancellationToken = default)
    {
        await SendSpanAsync(new
        {
            traceId = context.RunId,
            spanId = context.RunId,
            name = "agent-run",
            projectName = _projectName,
            input = new { query = context.Query },
            startTime = context.StartTime.ToUnixTimeMilliseconds(),
            metadata = context.Metadata
        }, cancellationToken);
    }

    public async Task OnRunEndAsync(RunContext context, RunResult result, CancellationToken cancellationToken = default)
    {
        await SendSpanAsync(new
        {
            traceId = context.RunId,
            spanId = context.RunId,
            output = new { response = result.Output },
            endTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            status = result.Success ? "OK" : "ERROR",
            errorMessage = result.Error
        }, cancellationToken);
    }

    public Task OnStepStartAsync(StepContext context, CancellationToken cancellationToken = default) => Task.CompletedTask;
    public Task OnStepEndAsync(StepContext context, StepResult result, CancellationToken cancellationToken = default) => Task.CompletedTask;

    public async Task OnToolCallAsync(ToolCallContext context, CancellationToken cancellationToken = default)
    {
        await SendSpanAsync(new
        {
            traceId = context.RunId,
            spanId = $"{context.RunId}-{context.ToolName}-{context.StepNumber}",
            parentSpanId = context.RunId,
            name = context.ToolName,
            spanType = "TOOL",
            input = context.Arguments,
            startTime = context.StartTime.ToUnixTimeMilliseconds()
        }, cancellationToken);
    }

    public async Task OnToolResultAsync(ToolCallContext context, ToolCallResult result, CancellationToken cancellationToken = default)
    {
        await SendSpanAsync(new
        {
            traceId = context.RunId,
            spanId = $"{context.RunId}-{context.ToolName}-{context.StepNumber}",
            output = result.Output,
            endTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            status = result.Success ? "OK" : "ERROR",
            errorMessage = result.Error
        }, cancellationToken);
    }

    public async Task OnLlmCallAsync(LlmCallContext context, CancellationToken cancellationToken = default)
    {
        await SendSpanAsync(new
        {
            traceId = context.RunId,
            spanId = $"{context.RunId}-llm-{context.StepNumber}",
            parentSpanId = context.RunId,
            name = "llm",
            spanType = "LLM",
            model = context.Model,
            startTime = context.StartTime.ToUnixTimeMilliseconds()
        }, cancellationToken);
    }

    public async Task OnLlmResultAsync(LlmCallContext context, LlmResult result, CancellationToken cancellationToken = default)
    {
        await SendSpanAsync(new
        {
            traceId = context.RunId,
            spanId = $"{context.RunId}-llm-{context.StepNumber}",
            endTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            usage = new { outputTokens = result.OutputTokens },
            status = result.Success ? "OK" : "ERROR"
        }, cancellationToken);
    }

    public Task OnErrorAsync(ErrorContext context, CancellationToken cancellationToken = default) => Task.CompletedTask;

    private async Task SendSpanAsync(object span, CancellationToken cancellationToken)
    {
        try
        {
            var json = JsonSerializer.Serialize(span, _jsonOptions);
            using var content = new StringContent(json, Encoding.UTF8, "application/json");
            await _httpClient.PostAsync($"{_baseUrl}/v1/spans", content, cancellationToken);
        }
        catch
        {
            // Silently ignore telemetry errors to not disrupt the main flow
        }
    }
}

/// <summary>
/// Console logging callback for debugging.
/// </summary>
public class ConsoleLoggingCallback : IObservabilityCallback
{
    private readonly bool _verbose;

    public ConsoleLoggingCallback(bool verbose = false)
    {
        _verbose = verbose;
    }

    public Task OnRunStartAsync(RunContext context, CancellationToken cancellationToken = default)
    {
        Console.WriteLine($"[{context.StartTime:HH:mm:ss}] 🚀 Run started: {context.RunId}");
        Console.WriteLine($"    Query: {context.Query}");
        return Task.CompletedTask;
    }

    public Task OnRunEndAsync(RunContext context, RunResult result, CancellationToken cancellationToken = default)
    {
        var icon = result.Success ? "✅" : "❌";
        Console.WriteLine($"[{DateTimeOffset.UtcNow:HH:mm:ss}] {icon} Run completed: {context.RunId}");
        Console.WriteLine($"    Steps: {result.TotalSteps}, Tool calls: {result.TotalToolCalls}, Duration: {result.Duration.TotalSeconds:F2}s");
        return Task.CompletedTask;
    }

    public Task OnStepStartAsync(StepContext context, CancellationToken cancellationToken = default)
    {
        if (_verbose)
            Console.WriteLine($"[{context.StartTime:HH:mm:ss}] 📍 Step {context.StepNumber} started");
        return Task.CompletedTask;
    }

    public Task OnStepEndAsync(StepContext context, StepResult result, CancellationToken cancellationToken = default)
    {
        if (_verbose)
            Console.WriteLine($"[{DateTimeOffset.UtcNow:HH:mm:ss}] 📍 Step {context.StepNumber} completed ({result.Duration.TotalMilliseconds:F0}ms)");
        return Task.CompletedTask;
    }

    public Task OnToolCallAsync(ToolCallContext context, CancellationToken cancellationToken = default)
    {
        Console.WriteLine($"[{context.StartTime:HH:mm:ss}] 🔧 Tool call: {context.ToolName}");
        return Task.CompletedTask;
    }

    public Task OnToolResultAsync(ToolCallContext context, ToolCallResult result, CancellationToken cancellationToken = default)
    {
        var icon = result.Success ? "✓" : "✗";
        Console.WriteLine($"[{DateTimeOffset.UtcNow:HH:mm:ss}]    {icon} {context.ToolName} ({result.Duration.TotalMilliseconds:F0}ms)");
        return Task.CompletedTask;
    }

    public Task OnLlmCallAsync(LlmCallContext context, CancellationToken cancellationToken = default)
    {
        if (_verbose)
            Console.WriteLine($"[{context.StartTime:HH:mm:ss}] 🤖 LLM call: {context.Model}");
        return Task.CompletedTask;
    }

    public Task OnLlmResultAsync(LlmCallContext context, LlmResult result, CancellationToken cancellationToken = default)
    {
        if (_verbose)
            Console.WriteLine($"[{DateTimeOffset.UtcNow:HH:mm:ss}]    LLM response ({result.OutputTokens} tokens, {result.Duration.TotalMilliseconds:F0}ms)");
        return Task.CompletedTask;
    }

    public Task OnErrorAsync(ErrorContext context, CancellationToken cancellationToken = default)
    {
        Console.WriteLine($"[{context.Timestamp:HH:mm:ss}] ❌ Error: {context.Exception.Message}");
        return Task.CompletedTask;
    }
}
