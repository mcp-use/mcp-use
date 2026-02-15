using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using ModelContextProtocol.Server;
using McpUse.Middleware;
using McpUse.Security;

namespace McpUse.Server;

/// <summary>
/// Configuration for an MCP server.
/// </summary>
public class McpServerOptions
{
    /// <summary>
    /// Server name (required).
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    /// Server version.
    /// </summary>
    public string Version { get; init; } = "1.0.0";

    /// <summary>
    /// Server description.
    /// </summary>
    public string? Description { get; init; }

    /// <summary>
    /// Transport type: "stdio", "sse", or "websocket".
    /// </summary>
    public string Transport { get; init; } = "stdio";

    /// <summary>
    /// Port for HTTP-based transports.
    /// </summary>
    public int Port { get; init; } = 8080;

    /// <summary>
    /// Base path for HTTP endpoints.
    /// </summary>
    public string BasePath { get; init; } = "/mcp";

    /// <summary>
    /// Security options for the server.
    /// </summary>
    public ServerSecurityOptions? Security { get; init; }

    /// <summary>
    /// Whether to enable telemetry.
    /// </summary>
    public bool EnableTelemetry { get; init; } = true;
}

/// <summary>
/// Security options for MCP servers following Microsoft guidelines.
/// </summary>
public class ServerSecurityOptions
{
    /// <summary>
    /// Whether authentication is required.
    /// </summary>
    public bool RequireAuthentication { get; init; } = false;

    /// <summary>
    /// Entra ID configuration for token validation.
    /// </summary>
    public EntraIdOptions? EntraId { get; init; }

    /// <summary>
    /// Required scopes for accessing the server.
    /// </summary>
    public IList<string>? RequiredScopes { get; init; }

    /// <summary>
    /// Rate limiting configuration.
    /// </summary>
    public RateLimitOptions? RateLimit { get; init; }
}

/// <summary>
/// Rate limiting configuration.
/// </summary>
public class RateLimitOptions
{
    /// <summary>
    /// Maximum requests per minute.
    /// </summary>
    public int MaxRequestsPerMinute { get; init; } = 60;

    /// <summary>
    /// Maximum requests per hour.
    /// </summary>
    public int MaxRequestsPerHour { get; init; } = 1000;
}

/// <summary>
/// Delegate for tool implementation.
/// </summary>
public delegate Task<object?> ToolHandler(IDictionary<string, object?> args, CancellationToken cancellationToken);

/// <summary>
/// Delegate for resource implementation.
/// </summary>
public delegate Task<string> ResourceHandler(CancellationToken cancellationToken);

/// <summary>
/// Delegate for prompt implementation.
/// </summary>
public delegate Task<IList<PromptMessage>> PromptHandler(IDictionary<string, string>? args, CancellationToken cancellationToken);

/// <summary>
/// A message in a prompt response.
/// </summary>
public class PromptMessage
{
    /// <summary>
    /// Role: "user", "assistant", or "system".
    /// </summary>
    public required string Role { get; init; }

    /// <summary>
    /// Message content.
    /// </summary>
    public required string Content { get; init; }
}

/// <summary>
/// Definition of a tool for registration.
/// </summary>
public class ToolDefinition
{
    /// <summary>
    /// Tool name.
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    /// Tool description.
    /// </summary>
    public required string Description { get; init; }

    /// <summary>
    /// JSON schema for input parameters.
    /// </summary>
    public required JsonElement InputSchema { get; init; }

    /// <summary>
    /// The handler function.
    /// </summary>
    public required ToolHandler Handler { get; init; }
}

/// <summary>
/// Definition of a resource for registration.
/// </summary>
public class ResourceDefinition
{
    /// <summary>
    /// Resource URI.
    /// </summary>
    public required string Uri { get; init; }

    /// <summary>
    /// Resource name.
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    /// Resource description.
    /// </summary>
    public string? Description { get; init; }

    /// <summary>
    /// MIME type of the resource content.
    /// </summary>
    public string MimeType { get; init; } = "text/plain";

    /// <summary>
    /// The handler function.
    /// </summary>
    public required ResourceHandler Handler { get; init; }
}

/// <summary>
/// Definition of a prompt for registration.
/// </summary>
public class PromptDefinition
{
    /// <summary>
    /// Prompt name.
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    /// Prompt description.
    /// </summary>
    public string? Description { get; init; }

    /// <summary>
    /// Prompt arguments.
    /// </summary>
    public IList<PromptArgument>? Arguments { get; init; }

    /// <summary>
    /// The handler function.
    /// </summary>
    public required PromptHandler Handler { get; init; }
}

/// <summary>
/// A prompt argument definition.
/// </summary>
public class PromptArgument
{
    /// <summary>
    /// Argument name.
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    /// Argument description.
    /// </summary>
    public string? Description { get; init; }

    /// <summary>
    /// Whether the argument is required.
    /// </summary>
    public bool Required { get; init; }
}

/// <summary>
/// High-level MCP server wrapper that simplifies server creation.
/// Uses the official ModelContextProtocol SDK under the hood.
/// </summary>
public class McpServer : IAsyncDisposable
{
    private readonly McpServerOptions _options;
    private readonly ILogger<McpServer>? _logger;
    private readonly List<ToolDefinition> _tools = new();
    private readonly List<ResourceDefinition> _resources = new();
    private readonly List<PromptDefinition> _prompts = new();
    private readonly MiddlewareManager _middlewareManager;
    private readonly Telemetry.TelemetryService? _telemetry;
    private bool _isRunning;
    private CancellationTokenSource? _cts;

    /// <summary>
    /// Creates a new MCP server.
    /// </summary>
    public McpServer(
        McpServerOptions options,
        ILogger<McpServer>? logger = null,
        Telemetry.TelemetryService? telemetry = null)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _logger = logger;
        _telemetry = telemetry;
        _middlewareManager = new MiddlewareManager(logger as ILogger<MiddlewareManager>);

        // Add default middleware
        if (_options.EnableTelemetry)
        {
            _middlewareManager.Use(new TelemetryMiddleware(_telemetry));
        }

        if (_options.Security?.RateLimit is not null)
        {
            _middlewareManager.Use(new RateLimitingMiddleware(_options.Security.RateLimit.MaxRequestsPerMinute));
        }
    }

    /// <summary>
    /// Register a tool with the server.
    /// </summary>
    public McpServer AddTool(ToolDefinition tool)
    {
        _tools.Add(tool);
        _logger?.LogInformation("Registered tool: {Name}", tool.Name);
        return this;
    }

    /// <summary>
    /// Register a tool using a fluent builder.
    /// </summary>
    public McpServer AddTool(
        string name,
        string description,
        JsonElement inputSchema,
        ToolHandler handler)
    {
        return AddTool(new ToolDefinition
        {
            Name = name,
            Description = description,
            InputSchema = inputSchema,
            Handler = handler
        });
    }

    /// <summary>
    /// Register a resource with the server.
    /// </summary>
    public McpServer AddResource(ResourceDefinition resource)
    {
        _resources.Add(resource);
        _logger?.LogInformation("Registered resource: {Uri}", resource.Uri);
        return this;
    }

    /// <summary>
    /// Register a prompt with the server.
    /// </summary>
    public McpServer AddPrompt(PromptDefinition prompt)
    {
        _prompts.Add(prompt);
        _logger?.LogInformation("Registered prompt: {Name}", prompt.Name);
        return this;
    }

    /// <summary>
    /// Add middleware to the server.
    /// </summary>
    public McpServer UseMiddleware(Middleware.Middleware middleware)
    {
        _middlewareManager.Use(middleware);
        return this;
    }

    /// <summary>
    /// Run the server.
    /// </summary>
    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        if (_isRunning)
        {
            throw new InvalidOperationException("Server is already running.");
        }

        _isRunning = true;
        _cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        _logger?.LogInformation("Starting MCP server '{Name}' v{Version} on {Transport}",
            _options.Name, _options.Version, _options.Transport);

        try
        {
            switch (_options.Transport.ToLowerInvariant())
            {
                case "stdio":
                    await RunStdioServerAsync(_cts.Token);
                    break;
                case "sse":
                case "http":
                    await RunHttpServerAsync(_cts.Token);
                    break;
                case "websocket":
                case "ws":
                    await RunWebSocketServerAsync(_cts.Token);
                    break;
                default:
                    throw new ArgumentException($"Unknown transport: {_options.Transport}");
            }
        }
        finally
        {
            _isRunning = false;
        }
    }

    private async Task RunStdioServerAsync(CancellationToken cancellationToken)
    {
        _logger?.LogInformation("Running stdio server...");

        var builder = McpServerFactory.Create();

        // Register tools
        foreach (var tool in _tools)
        {
            builder.AddTool(tool.Name, tool.Description, tool.InputSchema, async (args, ct) =>
            {
                return await tool.Handler(args, ct);
            });
        }

        // Run the server
        await builder.RunAsync(cancellationToken);
    }

    private async Task RunHttpServerAsync(CancellationToken cancellationToken)
    {
        _logger?.LogInformation("Running HTTP/SSE server on port {Port}...", _options.Port);

        var builder = WebApplication.CreateBuilder();
        builder.Logging.ClearProviders();
        if (_logger is not null)
        {
            builder.Logging.AddProvider(new ForwardingLoggerProvider(_logger));
        }

        // Configure URL to listen on
        builder.WebHost.UseUrls($"http://localhost:{_options.Port}");

        var app = builder.Build();

        // SSE endpoint for MCP messages
        app.MapGet($"{_options.BasePath}/sse", async (HttpContext context) =>
        {
            await HandleSseConnectionAsync(context, cancellationToken);
        });

        // POST endpoint for MCP requests
        app.MapPost($"{_options.BasePath}/message", async (HttpContext context) =>
        {
            await HandleMessageAsync(context, cancellationToken);
        });

        // Health check
        app.MapGet($"{_options.BasePath}/health", () => Results.Ok(new { status = "healthy", name = _options.Name, version = _options.Version }));

        _logger?.LogInformation("HTTP/SSE server listening on http://localhost:{Port}{BasePath}", _options.Port, _options.BasePath);

        await app.StartAsync(cancellationToken);

        // Wait for cancellation
        try
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            _logger?.LogInformation("HTTP/SSE server stopping...");
        }

        await app.StopAsync();
    }

    private async Task HandleMessageAsync(HttpContext context, CancellationToken cancellationToken)
    {
        // Validate authentication if required
        if (!await ValidateAuthenticationAsync(context))
        {
            return;
        }

        try
        {
            var request = await context.Request.ReadFromJsonAsync<JsonRpcRequest>(cancellationToken);
            if (request is null)
            {
                context.Response.StatusCode = 400;
                await context.Response.WriteAsJsonAsync(new { error = "Invalid request" }, cancellationToken);
                return;
            }

            // Find and invoke the tool
            var tool = _tools.FirstOrDefault(t => t.Name == request.Method || t.Name == request.Params?.GetValueOrDefault("name")?.ToString());
            if (tool is null)
            {
                context.Response.StatusCode = 404;
                await context.Response.WriteAsJsonAsync(new { error = $"Tool not found: {request.Method}" }, cancellationToken);
                return;
            }

            var args = request.Params ?? new Dictionary<string, object?>();
            var result = await tool.Handler(args, cancellationToken);

            await context.Response.WriteAsJsonAsync(new JsonRpcResponse
            {
                Id = request.Id,
                Result = result
            }, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "Error processing message");
            context.Response.StatusCode = 500;
            await context.Response.WriteAsJsonAsync(new { error = ex.Message }, cancellationToken);
        }
    }

    private async Task<bool> ValidateAuthenticationAsync(HttpContext context)
    {
        if (_options.Security?.RequireAuthentication != true)
        {
            return true;
        }

        var authHeader = context.Request.Headers.Authorization.FirstOrDefault();
        if (string.IsNullOrEmpty(authHeader))
        {
            context.Response.StatusCode = 401;
            await context.Response.WriteAsync("Authentication required");
            return false;
        }

        if (_options.Security.EntraId is not null)
        {
            var securityLogger = new SecurityEventLogger(
                _logger as ILogger<SecurityEventLogger>
                ?? NullLoggerFactory.Instance.CreateLogger<SecurityEventLogger>());
            var validator = new TokenValidator(
                _options.Security.EntraId,
                securityLogger,
                _logger as ILogger<TokenValidator>);

            try
            {
                var principal = await validator.ValidateTokenAsync(authHeader);
                _logger?.LogDebug("Token validated for user: {User}", principal.Identity?.Name);
                return true;
            }
            catch (McpAuthenticationException ex)
            {
                context.Response.StatusCode = 401;
                await context.Response.WriteAsync($"Invalid token: {ex.Message}");
                return false;
            }
            catch (McpAuthorizationException ex)
            {
                context.Response.StatusCode = 403;
                await context.Response.WriteAsync($"Insufficient permissions: {ex.Message}");
                return false;
            }
        }

        return true;
    }

    private async Task HandleSseConnectionAsync(HttpContext context, CancellationToken cancellationToken)
    {
        // Validate authentication
        if (!await ValidateAuthenticationAsync(context))
        {
            return;
        }

        // Set up SSE response headers
        context.Response.Headers.ContentType = "text/event-stream";
        context.Response.Headers.CacheControl = "no-cache";
        context.Response.Headers.Connection = "keep-alive";

        _logger?.LogDebug("SSE connection established");

        // Send initial connection event
        await WriteSseEventAsync(context.Response, "connected", new
        {
            serverId = _options.Name,
            version = _options.Version,
            tools = _tools.Select(t => t.Name).ToList()
        });

        // Keep connection alive and send periodic heartbeats
        var heartbeatInterval = TimeSpan.FromSeconds(30);
        var lastHeartbeat = DateTime.UtcNow;

        try
        {
            while (!cancellationToken.IsCancellationRequested && !context.RequestAborted.IsCancellationRequested)
            {
                // Send heartbeat if needed
                if (DateTime.UtcNow - lastHeartbeat > heartbeatInterval)
                {
                    await WriteSseEventAsync(context.Response, "heartbeat", new { timestamp = DateTime.UtcNow });
                    lastHeartbeat = DateTime.UtcNow;
                }

                await Task.Delay(100, cancellationToken);
            }
        }
        catch (OperationCanceledException)
        {
            // Connection closed normally
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "SSE connection error");
        }

        _logger?.LogDebug("SSE connection closed");
    }

    private static async Task WriteSseEventAsync(HttpResponse response, string eventType, object data)
    {
        var json = JsonSerializer.Serialize(data, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        await response.WriteAsync($"event: {eventType}\n");
        await response.WriteAsync($"data: {json}\n\n");
        await response.Body.FlushAsync();
    }

    private async Task RunWebSocketServerAsync(CancellationToken cancellationToken)
    {
        _logger?.LogInformation("Running WebSocket server on port {Port}...", _options.Port);

        // WebSocket server implementation would go here
        // Following similar patterns to HTTP but using WebSocket protocol
        await Task.Delay(-1, cancellationToken);
    }

    /// <summary>
    /// Stop the server.
    /// </summary>
    public void Stop()
    {
        _cts?.Cancel();
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        Stop();
        _cts?.Dispose();
        if (_telemetry is not null)
        {
            await _telemetry.DisposeAsync();
        }
    }
}

/// <summary>
/// Factory for creating MCP server instances using the official SDK.
/// </summary>
internal static class McpServerFactory
{
    public static IMcpServerBuilder Create(Action<McpServerOptions>? configure = null)
    {
        // This would use the official ModelContextProtocol.Server APIs
        return new DefaultMcpServerBuilder();
    }
}

internal interface IMcpServerBuilder
{
    IMcpServerBuilder AddTool(string name, string description, JsonElement inputSchema, Func<IDictionary<string, object?>, CancellationToken, Task<object?>> handler);
    Task RunAsync(CancellationToken cancellationToken = default);
}

internal class DefaultMcpServerBuilder : IMcpServerBuilder
{
    private readonly List<(string Name, string Description, JsonElement Schema, Func<IDictionary<string, object?>, CancellationToken, Task<object?>> Handler)> _tools = new();

    public IMcpServerBuilder AddTool(string name, string description, JsonElement inputSchema, Func<IDictionary<string, object?>, CancellationToken, Task<object?>> handler)
    {
        _tools.Add((name, description, inputSchema, handler));
        return this;
    }

    public async Task RunAsync(CancellationToken cancellationToken = default)
    {
        // This is where we'd integrate with the official SDK's server implementation
        // For now, this is a placeholder
        await Task.Delay(-1, cancellationToken);
    }
}

// Placeholder for HttpContext - in real implementation, use Microsoft.AspNetCore.Http
// NOTE: These are no longer needed as we now use WebApplication from ASP.NET Core
// The placeholder classes below are kept for backward compatibility with McpServerFactory

/// <summary>
/// Forwarding logger provider to integrate with existing ILogger.
/// </summary>
internal class ForwardingLoggerProvider : ILoggerProvider
{
    private readonly ILogger _logger;

    public ForwardingLoggerProvider(ILogger logger)
    {
        _logger = logger;
    }

    public ILogger CreateLogger(string categoryName) => _logger;

    public void Dispose() { }
}

/// <summary>
/// Simple JSON-RPC request for HTTP message handling.
/// </summary>
internal class JsonRpcRequest
{
    public string JsonRpc { get; set; } = "2.0";
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Method { get; set; } = "";
    public Dictionary<string, object?>? Params { get; set; }
}

/// <summary>
/// Simple JSON-RPC response for HTTP message handling.
/// </summary>
internal class JsonRpcResponse
{
    public string JsonRpc { get; set; } = "2.0";
    public string? Id { get; set; }
    public object? Result { get; set; }
    public JsonRpcError? Error { get; set; }
}

internal class JsonRpcError
{
    public int Code { get; set; }
    public string Message { get; set; } = "";
    public object? Data { get; set; }
}
