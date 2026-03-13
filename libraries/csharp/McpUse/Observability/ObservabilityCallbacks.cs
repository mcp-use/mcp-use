namespace McpUse.Observability;

/// <summary>
/// Interface for observability callbacks during agent execution.
/// </summary>
public interface IObservabilityCallback
{
    /// <summary>
    /// Called when a new run starts.
    /// </summary>
    Task OnRunStartAsync(RunContext context, CancellationToken cancellationToken = default);

    /// <summary>
    /// Called when a run completes.
    /// </summary>
    Task OnRunEndAsync(RunContext context, RunResult result, CancellationToken cancellationToken = default);

    /// <summary>
    /// Called when an agent step starts.
    /// </summary>
    Task OnStepStartAsync(StepContext context, CancellationToken cancellationToken = default);

    /// <summary>
    /// Called when an agent step completes.
    /// </summary>
    Task OnStepEndAsync(StepContext context, StepResult result, CancellationToken cancellationToken = default);

    /// <summary>
    /// Called when a tool is invoked.
    /// </summary>
    Task OnToolCallAsync(ToolCallContext context, CancellationToken cancellationToken = default);

    /// <summary>
    /// Called when a tool returns a result.
    /// </summary>
    Task OnToolResultAsync(ToolCallContext context, ToolCallResult result, CancellationToken cancellationToken = default);

    /// <summary>
    /// Called when an LLM call is made.
    /// </summary>
    Task OnLlmCallAsync(LlmCallContext context, CancellationToken cancellationToken = default);

    /// <summary>
    /// Called when an LLM call completes.
    /// </summary>
    Task OnLlmResultAsync(LlmCallContext context, LlmResult result, CancellationToken cancellationToken = default);

    /// <summary>
    /// Called when an error occurs.
    /// </summary>
    Task OnErrorAsync(ErrorContext context, CancellationToken cancellationToken = default);
}

/// <summary>
/// Context for a run.
/// </summary>
public class RunContext
{
    public string RunId { get; set; } = Guid.NewGuid().ToString();
    public string Query { get; set; } = string.Empty;
    public DateTimeOffset StartTime { get; set; } = DateTimeOffset.UtcNow;
    public Dictionary<string, object> Metadata { get; set; } = new();
}

/// <summary>
/// Result of a run.
/// </summary>
public class RunResult
{
    public bool Success { get; set; }
    public string? Output { get; set; }
    public int TotalSteps { get; set; }
    public int TotalToolCalls { get; set; }
    public TimeSpan Duration { get; set; }
    public string? Error { get; set; }
}

/// <summary>
/// Context for an agent step.
/// </summary>
public class StepContext
{
    public string RunId { get; set; } = string.Empty;
    public int StepNumber { get; set; }
    public DateTimeOffset StartTime { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// Result of a step.
/// </summary>
public class StepResult
{
    public bool HasToolCall { get; set; }
    public string? ToolName { get; set; }
    public string? Output { get; set; }
    public TimeSpan Duration { get; set; }
}

/// <summary>
/// Context for a tool call.
/// </summary>
public class ToolCallContext
{
    public string RunId { get; set; } = string.Empty;
    public int StepNumber { get; set; }
    public string ToolName { get; set; } = string.Empty;
    public object? Arguments { get; set; }
    public DateTimeOffset StartTime { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// Result of a tool call.
/// </summary>
public class ToolCallResult
{
    public bool Success { get; set; }
    public string? Output { get; set; }
    public string? Error { get; set; }
    public TimeSpan Duration { get; set; }
}

/// <summary>
/// Context for an LLM call.
/// </summary>
public class LlmCallContext
{
    public string RunId { get; set; } = string.Empty;
    public int StepNumber { get; set; }
    public string Model { get; set; } = string.Empty;
    public int InputTokens { get; set; }
    public DateTimeOffset StartTime { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// Result of an LLM call.
/// </summary>
public class LlmResult
{
    public bool Success { get; set; }
    public int OutputTokens { get; set; }
    public TimeSpan Duration { get; set; }
    public string? FinishReason { get; set; }
}

/// <summary>
/// Context for an error.
/// </summary>
public class ErrorContext
{
    public string RunId { get; set; } = string.Empty;
    public int? StepNumber { get; set; }
    public string? ToolName { get; set; }
    public Exception Exception { get; set; } = null!;
    public DateTimeOffset Timestamp { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// Manager for observability callbacks.
/// </summary>
public class ObservabilityManager
{
    private readonly List<IObservabilityCallback> _callbacks = new();

    /// <summary>
    /// Adds a callback.
    /// </summary>
    public void AddCallback(IObservabilityCallback callback)
    {
        _callbacks.Add(callback);
    }

    /// <summary>
    /// Removes a callback.
    /// </summary>
    public void RemoveCallback(IObservabilityCallback callback)
    {
        _callbacks.Remove(callback);
    }

    public async Task OnRunStartAsync(RunContext context, CancellationToken cancellationToken = default)
    {
        foreach (var callback in _callbacks)
        {
            try
            {
                await callback.OnRunStartAsync(context, cancellationToken);
            }
            catch
            {
                // Observability callbacks should not disrupt the main flow
            }
        }
    }

    public async Task OnRunEndAsync(RunContext context, RunResult result, CancellationToken cancellationToken = default)
    {
        foreach (var callback in _callbacks)
        {
            try
            {
                await callback.OnRunEndAsync(context, result, cancellationToken);
            }
            catch
            {
                // Observability callbacks should not disrupt the main flow
            }
        }
    }

    public async Task OnStepStartAsync(StepContext context, CancellationToken cancellationToken = default)
    {
        foreach (var callback in _callbacks)
        {
            try
            {
                await callback.OnStepStartAsync(context, cancellationToken);
            }
            catch
            {
                // Observability callbacks should not disrupt the main flow
            }
        }
    }

    public async Task OnStepEndAsync(StepContext context, StepResult result, CancellationToken cancellationToken = default)
    {
        foreach (var callback in _callbacks)
        {
            try
            {
                await callback.OnStepEndAsync(context, result, cancellationToken);
            }
            catch
            {
                // Observability callbacks should not disrupt the main flow
            }
        }
    }

    public async Task OnToolCallAsync(ToolCallContext context, CancellationToken cancellationToken = default)
    {
        foreach (var callback in _callbacks)
        {
            try
            {
                await callback.OnToolCallAsync(context, cancellationToken);
            }
            catch
            {
                // Observability callbacks should not disrupt the main flow
            }
        }
    }

    public async Task OnToolResultAsync(ToolCallContext context, ToolCallResult result, CancellationToken cancellationToken = default)
    {
        foreach (var callback in _callbacks)
        {
            try
            {
                await callback.OnToolResultAsync(context, result, cancellationToken);
            }
            catch
            {
                // Observability callbacks should not disrupt the main flow
            }
        }
    }

    public async Task OnLlmCallAsync(LlmCallContext context, CancellationToken cancellationToken = default)
    {
        foreach (var callback in _callbacks)
        {
            try
            {
                await callback.OnLlmCallAsync(context, cancellationToken);
            }
            catch
            {
                // Observability callbacks should not disrupt the main flow
            }
        }
    }

    public async Task OnLlmResultAsync(LlmCallContext context, LlmResult result, CancellationToken cancellationToken = default)
    {
        foreach (var callback in _callbacks)
        {
            try
            {
                await callback.OnLlmResultAsync(context, result, cancellationToken);
            }
            catch
            {
                // Observability callbacks should not disrupt the main flow
            }
        }
    }

    public async Task OnErrorAsync(ErrorContext context, CancellationToken cancellationToken = default)
    {
        foreach (var callback in _callbacks)
        {
            try
            {
                await callback.OnErrorAsync(context, cancellationToken);
            }
            catch
            {
                // Observability callbacks should not disrupt the main flow
            }
        }
    }
}
