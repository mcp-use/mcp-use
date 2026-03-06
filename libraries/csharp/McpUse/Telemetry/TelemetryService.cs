using System.Diagnostics;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using McpUse.Streaming;

namespace McpUse.Telemetry;

/// <summary>
/// Configuration for telemetry collection.
/// </summary>
public record TelemetryOptions
{
    /// <summary>
    /// Whether telemetry is enabled.
    /// </summary>
    public bool Enabled { get; init; } = true;

    /// <summary>
    /// Whether to include anonymized usage telemetry.
    /// </summary>
    public bool AnonymizedTelemetry { get; init; } = true;

    /// <summary>
    /// Langfuse configuration for observability.
    /// </summary>
    public LangfuseOptions? Langfuse { get; init; }

    /// <summary>
    /// Application Insights configuration.
    /// </summary>
    public ApplicationInsightsOptions? ApplicationInsights { get; init; }

    /// <summary>
    /// Custom telemetry sink.
    /// </summary>
    public ITelemetrySink? CustomSink { get; init; }
}

/// <summary>
/// Configuration for Langfuse observability platform.
/// </summary>
public class LangfuseOptions
{
    /// <summary>
    /// Langfuse public key.
    /// </summary>
    public required string PublicKey { get; init; }

    /// <summary>
    /// Langfuse secret key.
    /// </summary>
    public required string SecretKey { get; init; }

    /// <summary>
    /// Langfuse host URL. Defaults to https://cloud.langfuse.com.
    /// </summary>
    public string Host { get; init; } = "https://cloud.langfuse.com";

    /// <summary>
    /// Project name for grouping traces.
    /// </summary>
    public string? ProjectName { get; init; }

    /// <summary>
    /// Whether to flush events synchronously.
    /// </summary>
    public bool FlushOnComplete { get; init; } = true;
}

/// <summary>
/// Configuration for Azure Application Insights.
/// </summary>
public class ApplicationInsightsOptions
{
    /// <summary>
    /// Connection string for Application Insights.
    /// </summary>
    public required string ConnectionString { get; init; }

    /// <summary>
    /// Whether to enable dependency tracking.
    /// </summary>
    public bool EnableDependencyTracking { get; init; } = true;
}

/// <summary>
/// Interface for custom telemetry sinks.
/// </summary>
public interface ITelemetrySink
{
    /// <summary>
    /// Record a telemetry event.
    /// </summary>
    Task RecordAsync(TelemetryEvent telemetryEvent, CancellationToken cancellationToken = default);

    /// <summary>
    /// Flush any buffered events.
    /// </summary>
    Task FlushAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// A telemetry event for tracking agent operations.
/// </summary>
public class TelemetryEvent
{
    /// <summary>
    /// Unique event ID.
    /// </summary>
    public string Id { get; init; } = Guid.NewGuid().ToString();

    /// <summary>
    /// Event name.
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    /// Event timestamp.
    /// </summary>
    public DateTimeOffset Timestamp { get; init; } = DateTimeOffset.UtcNow;

    /// <summary>
    /// Duration of the operation in milliseconds.
    /// </summary>
    public long? DurationMs { get; init; }

    /// <summary>
    /// Whether the operation was successful.
    /// </summary>
    public bool Success { get; set; } = true;

    /// <summary>
    /// Error type if the operation failed.
    /// </summary>
    public string? ErrorType { get; init; }

    /// <summary>
    /// Error message if the operation failed.
    /// </summary>
    public string? ErrorMessage { get; set; }

    /// <summary>
    /// Additional properties for the event.
    /// </summary>
    public IDictionary<string, object?> Properties { get; init; } = new Dictionary<string, object?>();

    /// <summary>
    /// Metrics associated with the event.
    /// </summary>
    public IDictionary<string, double> Metrics { get; init; } = new Dictionary<string, double>();

    /// <summary>
    /// Parent trace/span ID for distributed tracing.
    /// </summary>
    public string? ParentId { get; init; }

    /// <summary>
    /// Trace ID for distributed tracing.
    /// </summary>
    public string? TraceId { get; init; }
}

/// <summary>
/// Service for capturing telemetry data.
/// </summary>
public class TelemetryService : IAsyncDisposable
{
    private readonly TelemetryOptions _options;
    private readonly ILogger<TelemetryService>? _logger;
    private readonly List<ITelemetrySink> _sinks = new();
    private readonly string _sessionId = Guid.NewGuid().ToString();
    private bool _isInitialized;

    /// <summary>
    /// Creates a new TelemetryService.
    /// </summary>
    public TelemetryService(TelemetryOptions? options = null, ILogger<TelemetryService>? logger = null)
    {
        _options = options ?? new TelemetryOptions();
        _logger = logger;

        // Check environment variable for opt-out
        var envDisabled = Environment.GetEnvironmentVariable("MCP_USE_ANONYMIZED_TELEMETRY")?.ToLowerInvariant() == "false";
        if (envDisabled)
        {
            _options = _options with { Enabled = false };
            _logger?.LogDebug("Telemetry disabled via environment variable");
        }
    }

    /// <summary>
    /// Initialize telemetry sinks.
    /// </summary>
    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        if (_isInitialized || !_options.Enabled) return;

        if (_options.Langfuse is not null)
        {
            _sinks.Add(new LangfuseSink(_options.Langfuse, _logger));
            _logger?.LogInformation("Langfuse telemetry sink initialized");
        }

        if (_options.ApplicationInsights is not null)
        {
            _sinks.Add(new ApplicationInsightsSink(_options.ApplicationInsights, _logger));
            _logger?.LogInformation("Application Insights telemetry sink initialized");
        }

        if (_options.CustomSink is not null)
        {
            _sinks.Add(_options.CustomSink);
            _logger?.LogInformation("Custom telemetry sink initialized");
        }

        _isInitialized = true;
    }

    /// <summary>
    /// Capture a telemetry event.
    /// </summary>
    public async Task CaptureAsync(TelemetryEvent telemetryEvent, CancellationToken cancellationToken = default)
    {
        if (!_options.Enabled) return;

        await InitializeAsync(cancellationToken);

        telemetryEvent.Properties["session_id"] = _sessionId;

        foreach (var sink in _sinks)
        {
            try
            {
                await sink.RecordAsync(telemetryEvent, cancellationToken);
            }
            catch (Exception ex)
            {
                _logger?.LogWarning(ex, "Error recording telemetry to sink");
            }
        }
    }

    /// <summary>
    /// Capture telemetry from a stream event.
    /// </summary>
    public async Task CaptureFromStreamEventAsync(StreamEvent streamEvent, CancellationToken cancellationToken = default)
    {
        var telemetryEvent = new TelemetryEvent
        {
            Name = $"stream_{streamEvent.EventType}",
            Timestamp = streamEvent.Timestamp,
            TraceId = streamEvent.RunId,
            Properties = new Dictionary<string, object?>
            {
                ["event_type"] = streamEvent.EventType.ToString(),
                ["step"] = streamEvent.Step
            }
        };

        // Extract metrics from event data
        if (streamEvent.Data is LlmEventData llmData)
        {
            if (llmData.DurationMs.HasValue)
            {
                telemetryEvent.Metrics["llm_duration_ms"] = llmData.DurationMs.Value;
            }
            if (llmData.Usage is not null)
            {
                if (llmData.Usage.InputTokens.HasValue)
                    telemetryEvent.Metrics["input_tokens"] = llmData.Usage.InputTokens.Value;
                if (llmData.Usage.OutputTokens.HasValue)
                    telemetryEvent.Metrics["output_tokens"] = llmData.Usage.OutputTokens.Value;
            }
        }
        else if (streamEvent.Data is ToolEventData toolData)
        {
            telemetryEvent.Properties["tool_name"] = toolData.ToolName;
            telemetryEvent.Success = !toolData.IsError;
            if (toolData.IsError)
            {
                telemetryEvent.ErrorMessage = toolData.ErrorMessage;
            }
            if (toolData.DurationMs.HasValue)
            {
                telemetryEvent.Metrics["tool_duration_ms"] = toolData.DurationMs.Value;
            }
        }
        else if (streamEvent.Data is AgentEventData agentData)
        {
            if (agentData.TotalSteps.HasValue)
            {
                telemetryEvent.Metrics["total_steps"] = agentData.TotalSteps.Value;
            }
            if (agentData.DurationMs.HasValue)
            {
                telemetryEvent.Metrics["agent_duration_ms"] = agentData.DurationMs.Value;
            }
        }

        await CaptureAsync(telemetryEvent, cancellationToken);
    }

    /// <summary>
    /// Create a scoped operation for automatic timing and completion tracking.
    /// </summary>
    public TelemetryOperation StartOperation(string name, string? traceId = null)
    {
        return new TelemetryOperation(this, name, traceId);
    }

    /// <summary>
    /// Flush all buffered telemetry.
    /// </summary>
    public async Task FlushAsync(CancellationToken cancellationToken = default)
    {
        foreach (var sink in _sinks)
        {
            try
            {
                await sink.FlushAsync(cancellationToken);
            }
            catch (Exception ex)
            {
                _logger?.LogWarning(ex, "Error flushing telemetry sink");
            }
        }
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        await FlushAsync();
        foreach (var disposable in _sinks.OfType<IAsyncDisposable>())
        {
            await disposable.DisposeAsync();
        }
    }
}

/// <summary>
/// Represents a scoped telemetry operation with automatic timing.
/// </summary>
public class TelemetryOperation : IAsyncDisposable
{
    private readonly TelemetryService _service;
    private readonly string _name;
    private readonly string? _traceId;
    private readonly Stopwatch _stopwatch;
    private readonly Dictionary<string, object?> _properties = new();
    private readonly Dictionary<string, double> _metrics = new();
    private bool _isCompleted;
    private bool _success = true;
    private string? _errorType;
    private string? _errorMessage;

    internal TelemetryOperation(TelemetryService service, string name, string? traceId)
    {
        _service = service;
        _name = name;
        _traceId = traceId;
        _stopwatch = Stopwatch.StartNew();
    }

    /// <summary>
    /// Add a property to the telemetry event.
    /// </summary>
    public TelemetryOperation WithProperty(string key, object? value)
    {
        _properties[key] = value;
        return this;
    }

    /// <summary>
    /// Add a metric to the telemetry event.
    /// </summary>
    public TelemetryOperation WithMetric(string key, double value)
    {
        _metrics[key] = value;
        return this;
    }

    /// <summary>
    /// Mark the operation as failed.
    /// </summary>
    public TelemetryOperation MarkFailed(Exception? ex = null)
    {
        _success = false;
        _errorType = ex?.GetType().Name;
        _errorMessage = ex?.Message;
        return this;
    }

    /// <summary>
    /// Complete the operation and record telemetry.
    /// </summary>
    public async Task CompleteAsync(CancellationToken cancellationToken = default)
    {
        if (_isCompleted) return;
        _isCompleted = true;

        _stopwatch.Stop();

        var telemetryEvent = new TelemetryEvent
        {
            Name = _name,
            DurationMs = _stopwatch.ElapsedMilliseconds,
            Success = _success,
            ErrorType = _errorType,
            ErrorMessage = _errorMessage,
            TraceId = _traceId,
            Properties = _properties,
            Metrics = _metrics
        };

        await _service.CaptureAsync(telemetryEvent, cancellationToken);
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        await CompleteAsync();
    }
}

/// <summary>
/// Langfuse telemetry sink for LLM observability.
/// </summary>
internal class LangfuseSink : ITelemetrySink
{
    private readonly LangfuseOptions _options;
    private readonly ILogger? _logger;
    private readonly HttpClient _httpClient;
    private readonly List<object> _buffer = new();

    public LangfuseSink(LangfuseOptions options, ILogger? logger)
    {
        _options = options;
        _logger = logger;
        _httpClient = new HttpClient
        {
            BaseAddress = new Uri(options.Host)
        };

        var credentials = Convert.ToBase64String(
            System.Text.Encoding.UTF8.GetBytes($"{options.PublicKey}:{options.SecretKey}"));
        _httpClient.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", credentials);
    }

    public Task RecordAsync(TelemetryEvent telemetryEvent, CancellationToken cancellationToken = default)
    {
        // Convert to Langfuse trace/span format
        var langfuseEvent = new
        {
            id = telemetryEvent.Id,
            name = telemetryEvent.Name,
            timestamp = telemetryEvent.Timestamp.ToString("o"),
            metadata = telemetryEvent.Properties,
            level = telemetryEvent.Success ? "DEFAULT" : "ERROR",
            statusMessage = telemetryEvent.ErrorMessage
        };

        lock (_buffer)
        {
            _buffer.Add(langfuseEvent);
        }

        return Task.CompletedTask;
    }

    public async Task FlushAsync(CancellationToken cancellationToken = default)
    {
        List<object> eventsToSend;
        lock (_buffer)
        {
            if (_buffer.Count == 0) return;
            eventsToSend = new List<object>(_buffer);
            _buffer.Clear();
        }

        try
        {
            var batch = new { batch = eventsToSend };
            using var content = new StringContent(
                JsonSerializer.Serialize(batch),
                System.Text.Encoding.UTF8,
                "application/json");

            var response = await _httpClient.PostAsync("/api/public/ingestion", content, cancellationToken);
            response.EnsureSuccessStatusCode();
        }
        catch (Exception ex)
        {
            _logger?.LogWarning(ex, "Failed to send telemetry to Langfuse");
        }
    }
}

/// <summary>
/// Application Insights telemetry sink.
/// </summary>
internal class ApplicationInsightsSink : ITelemetrySink
{
    private readonly ApplicationInsightsOptions _options;
    private readonly ILogger? _logger;

    // Note: In a real implementation, you would use Microsoft.ApplicationInsights.TelemetryClient
    // This is a simplified stub that shows the pattern

    public ApplicationInsightsSink(ApplicationInsightsOptions options, ILogger? logger)
    {
        _options = options;
        _logger = logger;
    }

    public Task RecordAsync(TelemetryEvent telemetryEvent, CancellationToken cancellationToken = default)
    {
        // In production, use TelemetryClient.TrackEvent or TrackDependency
        _logger?.LogDebug("AppInsights: {Name} - Success: {Success}, Duration: {Duration}ms",
            telemetryEvent.Name, telemetryEvent.Success, telemetryEvent.DurationMs);

        return Task.CompletedTask;
    }

    public Task FlushAsync(CancellationToken cancellationToken = default)
    {
        // In production, call TelemetryClient.Flush()
        return Task.CompletedTask;
    }
}

/// <summary>
/// Decorator attribute for automatic telemetry tracking.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public class TrackTelemetryAttribute : Attribute
{
    /// <summary>
    /// The event name to use for telemetry.
    /// </summary>
    public string? EventName { get; init; }

    /// <summary>
    /// Additional properties to include.
    /// </summary>
    public string[]? IncludeProperties { get; init; }
}
