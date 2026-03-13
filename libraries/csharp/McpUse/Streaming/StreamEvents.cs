using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.Extensions.AI;

namespace McpUse.Streaming;

/// <summary>
/// Types of events emitted during agent streaming.
/// </summary>
public enum StreamEventType
{
    /// <summary>Start of agent execution.</summary>
    AgentStart,

    /// <summary>End of agent execution.</summary>
    AgentEnd,

    /// <summary>Start of an LLM call.</summary>
    LlmStart,

    /// <summary>Token chunk from LLM streaming.</summary>
    LlmToken,

    /// <summary>End of an LLM call.</summary>
    LlmEnd,

    /// <summary>Tool call initiated.</summary>
    ToolStart,

    /// <summary>Tool call completed.</summary>
    ToolEnd,

    /// <summary>Error occurred during execution.</summary>
    Error,

    /// <summary>Custom event for extensibility.</summary>
    Custom
}

/// <summary>
/// An event emitted during streaming agent execution.
/// </summary>
public class StreamEvent
{
    /// <summary>
    /// The type of event.
    /// </summary>
    public required StreamEventType EventType { get; init; }

    /// <summary>
    /// Timestamp of the event.
    /// </summary>
    public DateTimeOffset Timestamp { get; init; } = DateTimeOffset.UtcNow;

    /// <summary>
    /// The current step number in the agent execution.
    /// </summary>
    public int Step { get; init; }

    /// <summary>
    /// Run ID for correlating events in a single execution.
    /// </summary>
    public string? RunId { get; init; }

    /// <summary>
    /// Event-specific data.
    /// </summary>
    public StreamEventData? Data { get; init; }

    /// <summary>
    /// Optional metadata for the event.
    /// </summary>
    public IDictionary<string, object?>? Metadata { get; init; }
}

/// <summary>
/// Data associated with a stream event.
/// </summary>
public abstract class StreamEventData { }

/// <summary>
/// Data for agent start/end events.
/// </summary>
public class AgentEventData : StreamEventData
{
    /// <summary>
    /// The input query to the agent.
    /// </summary>
    public string? Query { get; init; }

    /// <summary>
    /// The final result from the agent (for AgentEnd).
    /// </summary>
    public string? Result { get; init; }

    /// <summary>
    /// Total number of steps taken.
    /// </summary>
    public int? TotalSteps { get; init; }

    /// <summary>
    /// Total duration in milliseconds.
    /// </summary>
    public long? DurationMs { get; init; }
}

/// <summary>
/// Data for LLM events.
/// </summary>
public class LlmEventData : StreamEventData
{
    /// <summary>
    /// The input messages to the LLM.
    /// </summary>
    public IList<ChatMessage>? InputMessages { get; init; }

    /// <summary>
    /// The token chunk (for LlmToken events).
    /// </summary>
    public string? Token { get; init; }

    /// <summary>
    /// The complete response (for LlmEnd events).
    /// </summary>
    public ChatMessage? Response { get; init; }

    /// <summary>
    /// Token usage information.
    /// </summary>
    public TokenUsage? Usage { get; init; }

    /// <summary>
    /// Duration of the LLM call in milliseconds.
    /// </summary>
    public long? DurationMs { get; init; }
}

/// <summary>
/// Token usage information from LLM calls.
/// </summary>
public class TokenUsage
{
    /// <summary>
    /// Number of input/prompt tokens.
    /// </summary>
    public int? InputTokens { get; init; }

    /// <summary>
    /// Number of output/completion tokens.
    /// </summary>
    public int? OutputTokens { get; init; }

    /// <summary>
    /// Total tokens used.
    /// </summary>
    public int? TotalTokens => (InputTokens ?? 0) + (OutputTokens ?? 0);
}

/// <summary>
/// Data for tool events.
/// </summary>
public class ToolEventData : StreamEventData
{
    /// <summary>
    /// The name of the tool being called.
    /// </summary>
    public required string ToolName { get; init; }

    /// <summary>
    /// The arguments passed to the tool.
    /// </summary>
    public IDictionary<string, object?>? Arguments { get; init; }

    /// <summary>
    /// The result from the tool (for ToolEnd events).
    /// </summary>
    public object? Result { get; init; }

    /// <summary>
    /// Whether the tool call resulted in an error.
    /// </summary>
    public bool IsError { get; init; }

    /// <summary>
    /// Error message if the tool call failed.
    /// </summary>
    public string? ErrorMessage { get; init; }

    /// <summary>
    /// Duration of the tool call in milliseconds.
    /// </summary>
    public long? DurationMs { get; init; }
}

/// <summary>
/// Data for error events.
/// </summary>
public class ErrorEventData : StreamEventData
{
    /// <summary>
    /// The error message.
    /// </summary>
    public required string Message { get; init; }

    /// <summary>
    /// The exception type name.
    /// </summary>
    public string? ExceptionType { get; init; }

    /// <summary>
    /// Stack trace if available.
    /// </summary>
    public string? StackTrace { get; init; }
}

/// <summary>
/// Data for custom events.
/// </summary>
public class CustomEventData : StreamEventData
{
    /// <summary>
    /// Custom event name.
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    /// Custom event payload.
    /// </summary>
    public object? Payload { get; init; }
}

/// <summary>
/// Builder for creating stream events.
/// </summary>
public static class StreamEventBuilder
{
    /// <summary>
    /// Create an agent start event.
    /// </summary>
    public static StreamEvent AgentStart(string runId, string query, int step = 0)
    {
        return new StreamEvent
        {
            EventType = StreamEventType.AgentStart,
            RunId = runId,
            Step = step,
            Data = new AgentEventData { Query = query }
        };
    }

    /// <summary>
    /// Create an agent end event.
    /// </summary>
    public static StreamEvent AgentEnd(string runId, string result, int totalSteps, long durationMs)
    {
        return new StreamEvent
        {
            EventType = StreamEventType.AgentEnd,
            RunId = runId,
            Step = totalSteps,
            Data = new AgentEventData
            {
                Result = result,
                TotalSteps = totalSteps,
                DurationMs = durationMs
            }
        };
    }

    /// <summary>
    /// Create an LLM start event.
    /// </summary>
    public static StreamEvent LlmStart(string runId, IList<ChatMessage> messages, int step)
    {
        return new StreamEvent
        {
            EventType = StreamEventType.LlmStart,
            RunId = runId,
            Step = step,
            Data = new LlmEventData { InputMessages = messages }
        };
    }

    /// <summary>
    /// Create an LLM token event.
    /// </summary>
    public static StreamEvent LlmToken(string runId, string token, int step)
    {
        return new StreamEvent
        {
            EventType = StreamEventType.LlmToken,
            RunId = runId,
            Step = step,
            Data = new LlmEventData { Token = token }
        };
    }

    /// <summary>
    /// Create an LLM end event.
    /// </summary>
    public static StreamEvent LlmEnd(string runId, ChatMessage response, TokenUsage? usage, long durationMs, int step)
    {
        return new StreamEvent
        {
            EventType = StreamEventType.LlmEnd,
            RunId = runId,
            Step = step,
            Data = new LlmEventData
            {
                Response = response,
                Usage = usage,
                DurationMs = durationMs
            }
        };
    }

    /// <summary>
    /// Create a tool start event.
    /// </summary>
    public static StreamEvent ToolStart(string runId, string toolName, IDictionary<string, object?>? args, int step)
    {
        return new StreamEvent
        {
            EventType = StreamEventType.ToolStart,
            RunId = runId,
            Step = step,
            Data = new ToolEventData
            {
                ToolName = toolName,
                Arguments = args
            }
        };
    }

    /// <summary>
    /// Create a tool end event.
    /// </summary>
    public static StreamEvent ToolEnd(string runId, string toolName, object? result, bool isError, string? errorMessage, long durationMs, int step)
    {
        return new StreamEvent
        {
            EventType = StreamEventType.ToolEnd,
            RunId = runId,
            Step = step,
            Data = new ToolEventData
            {
                ToolName = toolName,
                Result = result,
                IsError = isError,
                ErrorMessage = errorMessage,
                DurationMs = durationMs
            }
        };
    }

    /// <summary>
    /// Create an error event.
    /// </summary>
    public static StreamEvent Error(string runId, Exception ex, int step)
    {
        return new StreamEvent
        {
            EventType = StreamEventType.Error,
            RunId = runId,
            Step = step,
            Data = new ErrorEventData
            {
                Message = ex.Message,
                ExceptionType = ex.GetType().Name,
                StackTrace = ex.StackTrace
            }
        };
    }

    /// <summary>
    /// Create a custom event.
    /// </summary>
    public static StreamEvent Custom(string runId, string name, object? payload, int step)
    {
        return new StreamEvent
        {
            EventType = StreamEventType.Custom,
            RunId = runId,
            Step = step,
            Data = new CustomEventData
            {
                Name = name,
                Payload = payload
            }
        };
    }
}

/// <summary>
/// Delegate for handling stream events.
/// </summary>
public delegate Task StreamEventHandler(StreamEvent streamEvent, CancellationToken cancellationToken);

/// <summary>
/// Interface for emitting stream events.
/// </summary>
public interface IStreamEventEmitter
{
    /// <summary>
    /// Emit a stream event.
    /// </summary>
    Task EmitAsync(StreamEvent streamEvent, CancellationToken cancellationToken = default);
}

/// <summary>
/// Default implementation that collects events into a channel for async enumeration.
/// </summary>
public class StreamEventCollector : IStreamEventEmitter, IAsyncDisposable
{
    private readonly System.Threading.Channels.Channel<StreamEvent> _channel;
    private bool _isCompleted;

    public StreamEventCollector(int capacity = 1000)
    {
        _channel = System.Threading.Channels.Channel.CreateBounded<StreamEvent>(
            new System.Threading.Channels.BoundedChannelOptions(capacity)
            {
                FullMode = System.Threading.Channels.BoundedChannelFullMode.Wait
            });
    }

    /// <inheritdoc />
    public async Task EmitAsync(StreamEvent streamEvent, CancellationToken cancellationToken = default)
    {
        if (!_isCompleted)
        {
            await _channel.Writer.WriteAsync(streamEvent, cancellationToken);
        }
    }

    /// <summary>
    /// Get events as an async enumerable.
    /// </summary>
    public async IAsyncEnumerable<StreamEvent> GetEventsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        await foreach (var evt in _channel.Reader.ReadAllAsync(cancellationToken))
        {
            yield return evt;
        }
    }

    /// <summary>
    /// Complete the event stream.
    /// </summary>
    public void Complete()
    {
        _isCompleted = true;
        _channel.Writer.Complete();
    }

    /// <inheritdoc />
    public ValueTask DisposeAsync()
    {
        Complete();
        return ValueTask.CompletedTask;
    }
}
