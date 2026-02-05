using System.Text.Json;
using Microsoft.Extensions.Logging;
using ModelContextProtocol.Protocol;

namespace McpUse.Middleware;

/// <summary>
/// Context for middleware processing requests.
/// </summary>
/// <typeparam name="T">The type of request parameters.</typeparam>
public class MiddlewareContext<T>
{
    /// <summary>
    /// Unique identifier for this request.
    /// </summary>
    public required string Id { get; init; }

    /// <summary>
    /// The JSON-RPC method name (e.g., "tools/call").
    /// </summary>
    public required string Method { get; init; }

    /// <summary>
    /// The typed parameters for the method.
    /// </summary>
    public required T Params { get; init; }

    /// <summary>
    /// Connection identifier for the client session.
    /// </summary>
    public string? ConnectionId { get; init; }

    /// <summary>
    /// Request timestamp.
    /// </summary>
    public DateTimeOffset Timestamp { get; init; } = DateTimeOffset.UtcNow;

    /// <summary>
    /// Custom metadata for the request.
    /// </summary>
    public IDictionary<string, object?> Metadata { get; init; } = new Dictionary<string, object?>();
}

/// <summary>
/// Context for middleware processing responses.
/// </summary>
public class ResponseContext
{
    /// <summary>
    /// Request ID this response is for.
    /// </summary>
    public required string RequestId { get; init; }

    /// <summary>
    /// The result of the operation.
    /// </summary>
    public object? Result { get; init; }

    /// <summary>
    /// Error if the operation failed.
    /// </summary>
    public Exception? Error { get; init; }

    /// <summary>
    /// Duration of the request processing.
    /// </summary>
    public TimeSpan Duration { get; init; }

    /// <summary>
    /// Custom metadata.
    /// </summary>
    public IDictionary<string, object?> Metadata { get; init; } = new Dictionary<string, object?>();
}

/// <summary>
/// Delegate for the next middleware in the chain.
/// </summary>
public delegate Task<object?> NextMiddleware<T>(MiddlewareContext<T> context);

/// <summary>
/// Base class for MCP middleware.
/// </summary>
public abstract class Middleware
{
    /// <summary>
    /// Process a request through the middleware.
    /// </summary>
    public virtual async Task<object?> InvokeAsync<T>(
        MiddlewareContext<T> context,
        NextMiddleware<T> next)
    {
        // Default implementation just calls next
        return await next(context);
    }

    // Method-specific hooks (override to intercept specific operations)

    /// <summary>
    /// Called for any request before method-specific processing.
    /// </summary>
    public virtual Task OnRequestAsync<T>(MiddlewareContext<T> context)
    {
        return Task.CompletedTask;
    }

    /// <summary>
    /// Called after a response is generated.
    /// </summary>
    public virtual Task OnResponseAsync(ResponseContext context)
    {
        return Task.CompletedTask;
    }

    /// <summary>
    /// Called for tools/call requests.
    /// </summary>
    public virtual Task<object?> OnCallToolAsync(
        MiddlewareContext<CallToolRequestParams> context,
        NextMiddleware<CallToolRequestParams> next)
    {
        return next(context);
    }

    /// <summary>
    /// Called for tools/list requests.
    /// </summary>
    public virtual Task<object?> OnListToolsAsync(
        MiddlewareContext<ListToolsRequestParams> context,
        NextMiddleware<ListToolsRequestParams> next)
    {
        return next(context);
    }

    /// <summary>
    /// Called for resources/list requests.
    /// </summary>
    public virtual Task<object?> OnListResourcesAsync(
        MiddlewareContext<ListResourcesRequestParams> context,
        NextMiddleware<ListResourcesRequestParams> next)
    {
        return next(context);
    }

    /// <summary>
    /// Called for resources/read requests.
    /// </summary>
    public virtual Task<object?> OnReadResourceAsync(
        MiddlewareContext<ReadResourceRequestParams> context,
        NextMiddleware<ReadResourceRequestParams> next)
    {
        return next(context);
    }

    /// <summary>
    /// Called for prompts/list requests.
    /// </summary>
    public virtual Task<object?> OnListPromptsAsync(
        MiddlewareContext<ListPromptsRequestParams> context,
        NextMiddleware<ListPromptsRequestParams> next)
    {
        return next(context);
    }

    /// <summary>
    /// Called for prompts/get requests.
    /// </summary>
    public virtual Task<object?> OnGetPromptAsync(
        MiddlewareContext<GetPromptRequestParams> context,
        NextMiddleware<GetPromptRequestParams> next)
    {
        return next(context);
    }
}

/// <summary>
/// Manages a chain of middleware for MCP request processing.
/// </summary>
public class MiddlewareManager
{
    private readonly List<Middleware> _middlewares = new();
    private readonly ILogger<MiddlewareManager>? _logger;

    public MiddlewareManager(ILogger<MiddlewareManager>? logger = null)
    {
        _logger = logger;
    }

    /// <summary>
    /// Add a middleware to the chain.
    /// </summary>
    public MiddlewareManager Use(Middleware middleware)
    {
        _middlewares.Add(middleware);
        return this;
    }

    /// <summary>
    /// Add a middleware using a factory function.
    /// </summary>
    public MiddlewareManager Use<TMiddleware>() where TMiddleware : Middleware, new()
    {
        return Use(new TMiddleware());
    }

    /// <summary>
    /// Process a request through the middleware chain.
    /// </summary>
    public async Task<ResponseContext> ProcessAsync<T>(
        MiddlewareContext<T> context,
        Func<MiddlewareContext<T>, Task<object?>> finalHandler)
    {
        var startTime = DateTimeOffset.UtcNow;
        object? result = null;
        Exception? error = null;

        try
        {
            // Build the middleware chain
            NextMiddleware<T> chain = async (ctx) => await finalHandler(ctx);

            // Wrap each middleware around the chain (in reverse order)
            foreach (var middleware in _middlewares.AsEnumerable().Reverse())
            {
                var next = chain;
                chain = async (ctx) =>
                {
                    await middleware.OnRequestAsync(ctx);
                    return await middleware.InvokeAsync(ctx, next);
                };
            }

            result = await chain(context);
        }
        catch (Exception ex)
        {
            error = ex;
            _logger?.LogError(ex, "Error in middleware chain for {Method}", context.Method);
        }

        var responseContext = new ResponseContext
        {
            RequestId = context.Id,
            Result = result,
            Error = error,
            Duration = DateTimeOffset.UtcNow - startTime,
            Metadata = context.Metadata
        };

        // Call OnResponse for all middleware
        foreach (var middleware in _middlewares)
        {
            try
            {
                await middleware.OnResponseAsync(responseContext);
            }
            catch (Exception ex)
            {
                _logger?.LogWarning(ex, "Error in middleware OnResponse");
            }
        }

        return responseContext;
    }
}

/// <summary>
/// Logging middleware that records all requests and responses.
/// </summary>
public class LoggingMiddleware : Middleware
{
    private readonly ILogger? _logger;
    private readonly bool _logRequestBody;
    private readonly bool _logResponseBody;

    public LoggingMiddleware(ILogger? logger = null, bool logRequestBody = false, bool logResponseBody = false)
    {
        _logger = logger;
        _logRequestBody = logRequestBody;
        _logResponseBody = logResponseBody;
    }

    public override Task OnRequestAsync<T>(MiddlewareContext<T> context)
    {
        if (_logRequestBody)
        {
            _logger?.LogInformation("MCP Request [{Id}] {Method}: {Params}",
                context.Id, context.Method, JsonSerializer.Serialize(context.Params));
        }
        else
        {
            _logger?.LogInformation("MCP Request [{Id}] {Method}", context.Id, context.Method);
        }
        return Task.CompletedTask;
    }

    public override Task OnResponseAsync(ResponseContext context)
    {
        if (context.Error is not null)
        {
            _logger?.LogError(context.Error, "MCP Response [{Id}] Error after {Duration}ms",
                context.RequestId, context.Duration.TotalMilliseconds);
        }
        else if (_logResponseBody)
        {
            _logger?.LogInformation("MCP Response [{Id}] Success in {Duration}ms: {Result}",
                context.RequestId, context.Duration.TotalMilliseconds, JsonSerializer.Serialize(context.Result));
        }
        else
        {
            _logger?.LogInformation("MCP Response [{Id}] Success in {Duration}ms",
                context.RequestId, context.Duration.TotalMilliseconds);
        }
        return Task.CompletedTask;
    }
}

/// <summary>
/// Telemetry middleware that tracks request metrics.
/// </summary>
public class TelemetryMiddleware : Middleware
{
    private readonly Telemetry.TelemetryService? _telemetry;

    public TelemetryMiddleware(Telemetry.TelemetryService? telemetry = null)
    {
        _telemetry = telemetry;
    }

    public override async Task OnResponseAsync(ResponseContext context)
    {
        if (_telemetry is null) return;

        await _telemetry.CaptureAsync(new Telemetry.TelemetryEvent
        {
            Name = "mcp_request",
            DurationMs = (long)context.Duration.TotalMilliseconds,
            Success = context.Error is null,
            ErrorType = context.Error?.GetType().Name,
            ErrorMessage = context.Error?.Message,
            Properties = new Dictionary<string, object?>
            {
                ["request_id"] = context.RequestId
            }
        });
    }
}

/// <summary>
/// Rate limiting middleware.
/// </summary>
public class RateLimitingMiddleware : Middleware
{
    private readonly int _maxRequestsPerMinute;
    private readonly Dictionary<string, Queue<DateTimeOffset>> _requestHistory = new();
    private readonly object _lock = new();

    public RateLimitingMiddleware(int maxRequestsPerMinute = 60)
    {
        _maxRequestsPerMinute = maxRequestsPerMinute;
    }

    public override Task OnRequestAsync<T>(MiddlewareContext<T> context)
    {
        var connectionId = context.ConnectionId ?? "default";
        var now = DateTimeOffset.UtcNow;
        var windowStart = now.AddMinutes(-1);

        lock (_lock)
        {
            if (!_requestHistory.TryGetValue(connectionId, out var history))
            {
                history = new Queue<DateTimeOffset>();
                _requestHistory[connectionId] = history;
            }

            // Remove old entries
            while (history.Count > 0 && history.Peek() < windowStart)
            {
                history.Dequeue();
            }

            // Check limit
            if (history.Count >= _maxRequestsPerMinute)
            {
                throw new McpRateLimitException(
                    $"Rate limit exceeded. Max {_maxRequestsPerMinute} requests per minute.");
            }

            history.Enqueue(now);
        }

        return Task.CompletedTask;
    }
}

/// <summary>
/// Tool filtering middleware that restricts which tools can be called.
/// </summary>
public class ToolFilterMiddleware : Middleware
{
    private readonly HashSet<string> _allowedTools;
    private readonly HashSet<string> _blockedTools;
    private readonly bool _useAllowList;

    public ToolFilterMiddleware(IEnumerable<string>? allowedTools = null, IEnumerable<string>? blockedTools = null)
    {
        _allowedTools = allowedTools?.ToHashSet(StringComparer.OrdinalIgnoreCase) ?? new HashSet<string>();
        _blockedTools = blockedTools?.ToHashSet(StringComparer.OrdinalIgnoreCase) ?? new HashSet<string>();
        _useAllowList = _allowedTools.Count > 0;
    }

    public override Task<object?> OnCallToolAsync(
        MiddlewareContext<CallToolRequestParams> context,
        NextMiddleware<CallToolRequestParams> next)
    {
        var toolName = context.Params.Name;

        if (_useAllowList && !_allowedTools.Contains(toolName))
        {
            throw new McpAuthorizationException($"Tool '{toolName}' is not in the allowed list.");
        }

        if (_blockedTools.Contains(toolName))
        {
            throw new McpAuthorizationException($"Tool '{toolName}' is blocked.");
        }

        return next(context);
    }
}

/// <summary>
/// Caching middleware for tool results.
/// </summary>
public class CachingMiddleware : Middleware
{
    private readonly Dictionary<string, (object? Result, DateTimeOffset Expiry)> _cache = new();
    private readonly TimeSpan _defaultTtl;
    private readonly object _lock = new();

    public CachingMiddleware(TimeSpan? defaultTtl = null)
    {
        _defaultTtl = defaultTtl ?? TimeSpan.FromMinutes(5);
    }

    public override async Task<object?> OnCallToolAsync(
        MiddlewareContext<CallToolRequestParams> context,
        NextMiddleware<CallToolRequestParams> next)
    {
        var cacheKey = $"{context.Params.Name}:{JsonSerializer.Serialize(context.Params.Arguments)}";

        lock (_lock)
        {
            if (_cache.TryGetValue(cacheKey, out var cached) && cached.Expiry > DateTimeOffset.UtcNow)
            {
                context.Metadata["cache_hit"] = true;
                return cached.Result;
            }
        }

        var result = await next(context);

        lock (_lock)
        {
            _cache[cacheKey] = (result, DateTimeOffset.UtcNow.Add(_defaultTtl));
        }

        context.Metadata["cache_hit"] = false;
        return result;
    }

    /// <summary>
    /// Clear the cache.
    /// </summary>
    public void Clear()
    {
        lock (_lock)
        {
            _cache.Clear();
        }
    }
}

// Placeholder types for MCP protocol parameters (these would come from the official SDK)
public class CallToolRequestParams { public string Name { get; set; } = ""; public IDictionary<string, object?>? Arguments { get; set; } }
public class ListToolsRequestParams { }
public class ListResourcesRequestParams { }
public class ReadResourceRequestParams { public string Uri { get; set; } = ""; }
public class ListPromptsRequestParams { }
public class GetPromptRequestParams { public string Name { get; set; } = ""; public IDictionary<string, string>? Arguments { get; set; } }
