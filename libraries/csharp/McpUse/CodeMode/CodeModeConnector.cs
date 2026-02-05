using System.ComponentModel;
using System.Text;
using System.Text.Json;
using Microsoft.CodeAnalysis.CSharp.Scripting;
using Microsoft.CodeAnalysis.Scripting;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using McpUse.Client;

namespace McpUse.CodeMode;

/// <summary>
/// Configuration for Code Mode execution.
/// </summary>
public class CodeModeConfig
{
    /// <summary>
    /// Whether code mode is enabled.
    /// </summary>
    public bool Enabled { get; init; } = true;

    /// <summary>
    /// The executor to use: "roslyn" (in-process C# scripting) or "isolated" (future: process isolation).
    /// </summary>
    public string Executor { get; init; } = "roslyn";

    /// <summary>
    /// Default execution timeout in milliseconds.
    /// </summary>
    public int DefaultTimeoutMs { get; init; } = 30000;

    /// <summary>
    /// Maximum allowed execution timeout in milliseconds.
    /// </summary>
    public int MaxTimeoutMs { get; init; } = 60000;

    /// <summary>
    /// Additional namespaces to import in the script context.
    /// </summary>
    public IList<string> AdditionalImports { get; init; } = new List<string>();
}

/// <summary>
/// Provides a "code mode" interface for executing C# code with access to MCP tools.
/// Unlike other connectors, it doesn't establish its own external connection - 
/// instead, it wraps an already-connected McpUseClient and exposes special tools
/// (execute_code, search_tools) on top of it.
/// </summary>
public class CodeModeConnector : IAsyncDisposable
{
    private readonly McpUseClient _client;
    private readonly CodeModeConfig _config;
    private readonly ILogger<CodeModeConnector>? _logger;
    private readonly Dictionary<string, Func<JsonElement, Task<object?>>> _toolExecutors = new();
    private bool _isInitialized;

    /// <summary>
    /// System prompt to guide the LLM on using code mode.
    /// </summary>
    public const string CodeModeAgentPrompt = """
## MCP Code Mode Tool Usage Guide

You have access to an MCP Code Mode Client that allows you to execute C# code with access to registered tools. Follow this workflow:

### 1. Tool Discovery Phase
**Always start by discovering available tools:**
- Use the `search_tools` function to find available tools
- Tools are available as async methods that can be called from your code

```csharp
// Find all GitHub-related tools
var tools = await search_tools("github");
foreach (var tool in tools) {
    Console.WriteLine($"{tool.Server}.{tool.Name}: {tool.Description}");
}
```

### 2. Code Execution Guidelines
**When writing code:**
- Use `await tool_name(args)` syntax for all tool calls
- Tools are async methods that return Task<object?>
- You have access to standard .NET types and common namespaces
- All console output is automatically captured and returned
- Build properly structured input objects based on tool schemas
- Handle errors appropriately with try/catch blocks

### 3. Available Runtime Context
- `search_tools(query)`: Function to discover tools
- Tool methods registered dynamically based on MCP servers
- Standard .NET libraries for data processing

### Example Workflow

```csharp
// 1. Discover available tools
var tools = await search_tools("file");

// 2. Call tools with proper parameters
var result = await read_file(new { path = "README.md" });

// 3. Process results
Console.WriteLine($"File content: {result}");

// 4. Return structured results
return new { success = true, content = result };
```

Remember: Always discover and understand available tools before attempting to use them in code execution.
""";

    /// <summary>
    /// Creates a new CodeModeConnector instance.
    /// </summary>
    /// <param name="client">The MCP client to use for tool access.</param>
    /// <param name="config">Code mode configuration.</param>
    /// <param name="logger">Optional logger.</param>
    public CodeModeConnector(
        McpUseClient client,
        CodeModeConfig? config = null,
        ILogger<CodeModeConnector>? logger = null)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
        _config = config ?? new CodeModeConfig();
        _logger = logger;
    }

    /// <summary>
    /// Initialize the code mode connector and register tool executors.
    /// </summary>
    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        if (_isInitialized) return;

        // Get all tools from all sessions and register executors
        foreach (var serverName in _client.ServerNames)
        {
            var session = _client.GetSession(serverName);
            if (session is null)
            {
                session = await _client.CreateSessionAsync(serverName, cancellationToken);
            }

            var tools = await session.ListToolsAsync(cancellationToken);
            foreach (var tool in tools)
            {
                var toolKey = $"{serverName}_{tool.Name}";
                _toolExecutors[toolKey] = async (args) =>
                {
                    var argsDict = JsonSerializer.Deserialize<Dictionary<string, object?>>(args.GetRawText())
                        ?? new Dictionary<string, object?>();
                    return await session.CallToolAsync(tool.Name, argsDict, cancellationToken);
                };
            }
        }

        _isInitialized = true;
        _logger?.LogInformation("Code mode initialized with {Count} tool executors", _toolExecutors.Count);
    }

    /// <summary>
    /// Gets the AI functions exposed by code mode (execute_code and search_tools).
    /// </summary>
    public IList<AIFunction> GetFunctions()
    {
        return new List<AIFunction>
        {
            AIFunctionFactory.Create(ExecuteCodeAsync, "execute_code",
                "Execute C# code with access to MCP tools. " +
                "This is the PRIMARY way to interact with MCP servers in code mode. " +
                "Write code that discovers tools using search_tools(), calls tools, " +
                "processes data efficiently, and returns results."),
            AIFunctionFactory.Create(SearchToolsAsync, "search_tools",
                "Search and discover available MCP tools across all servers. " +
                "Use this to find out what tools are available before writing code.")
        };
    }

    /// <summary>
    /// Execute C# code with access to MCP tools.
    /// </summary>
    [Description("Execute C# code with access to MCP tools.")]
    public async Task<CodeExecutionResult> ExecuteCodeAsync(
        [Description("C# code to execute. Use 'await' for async operations.")] string code,
        [Description("Execution timeout in milliseconds")] int? timeout = null,
        CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken);

        var effectiveTimeout = Math.Min(timeout ?? _config.DefaultTimeoutMs, _config.MaxTimeoutMs);
        var output = new StringBuilder();
        var startTime = DateTime.UtcNow;

        try
        {
            // Create script options with necessary imports
            var scriptOptions = ScriptOptions.Default
                .AddReferences(typeof(object).Assembly)
                .AddReferences(typeof(Console).Assembly)
                .AddReferences(typeof(JsonSerializer).Assembly)
                .AddImports("System", "System.Collections.Generic", "System.Linq", "System.Text.Json", "System.Threading.Tasks");

            foreach (var import in _config.AdditionalImports)
            {
                scriptOptions = scriptOptions.AddImports(import);
            }

            // Create globals with tool access
            var globals = new CodeModeGlobals(
                _toolExecutors,
                msg => output.AppendLine(msg),
                _logger);

            // Execute with timeout
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            cts.CancelAfter(effectiveTimeout);

            var result = await CSharpScript.EvaluateAsync<object?>(
                code,
                scriptOptions,
                globals,
                typeof(CodeModeGlobals),
                cts.Token);

            var duration = DateTime.UtcNow - startTime;

            return new CodeExecutionResult
            {
                Success = true,
                Output = output.ToString(),
                Result = result,
                DurationMs = (int)duration.TotalMilliseconds
            };
        }
        catch (OperationCanceledException)
        {
            return new CodeExecutionResult
            {
                Success = false,
                Output = output.ToString(),
                Error = $"Execution timed out after {effectiveTimeout}ms",
                DurationMs = effectiveTimeout
            };
        }
        catch (CompilationErrorException ex)
        {
            return new CodeExecutionResult
            {
                Success = false,
                Output = output.ToString(),
                Error = $"Compilation error: {string.Join(Environment.NewLine, ex.Diagnostics)}",
                DurationMs = (int)(DateTime.UtcNow - startTime).TotalMilliseconds
            };
        }
        catch (Exception ex)
        {
            return new CodeExecutionResult
            {
                Success = false,
                Output = output.ToString(),
                Error = $"Execution error: {ex.Message}",
                DurationMs = (int)(DateTime.UtcNow - startTime).TotalMilliseconds
            };
        }
    }

    /// <summary>
    /// Search for available MCP tools.
    /// </summary>
    [Description("Search and discover available MCP tools across all servers.")]
    public async Task<IList<ToolInfo>> SearchToolsAsync(
        [Description("Search query to filter tools by name or description")] string? query = null,
        [Description("Detail level: 'names', 'descriptions', or 'full'")] string detailLevel = "full",
        CancellationToken cancellationToken = default)
    {
        await InitializeAsync(cancellationToken);

        var results = new List<ToolInfo>();
        var queryLower = query?.ToLowerInvariant() ?? "";

        foreach (var serverName in _client.ServerNames)
        {
            var session = _client.GetSession(serverName);
            if (session is null) continue;

            var tools = await session.ListToolsAsync(cancellationToken);
            foreach (var tool in tools)
            {
                // Filter by query if provided
                if (!string.IsNullOrEmpty(queryLower))
                {
                    var nameLower = tool.Name.ToLowerInvariant();
                    var descLower = (tool.Description ?? "").ToLowerInvariant();
                    if (!nameLower.Contains(queryLower) && !descLower.Contains(queryLower))
                    {
                        continue;
                    }
                }

                results.Add(new ToolInfo
                {
                    Server = serverName,
                    Name = tool.Name,
                    Description = detailLevel != "names" ? tool.Description : null,
                    InputSchema = detailLevel == "full" ? tool.JsonSchema : null
                });
            }
        }

        return results;
    }

    /// <inheritdoc />
    public ValueTask DisposeAsync()
    {
        _toolExecutors.Clear();
        _isInitialized = false;
        return ValueTask.CompletedTask;
    }
}

/// <summary>
/// Result from code execution.
/// </summary>
public class CodeExecutionResult
{
    /// <summary>
    /// Whether execution was successful.
    /// </summary>
    public bool Success { get; init; }

    /// <summary>
    /// Console output captured during execution.
    /// </summary>
    public string? Output { get; init; }

    /// <summary>
    /// The return value from the script, if any.
    /// </summary>
    public object? Result { get; init; }

    /// <summary>
    /// Error message if execution failed.
    /// </summary>
    public string? Error { get; init; }

    /// <summary>
    /// Execution duration in milliseconds.
    /// </summary>
    public int DurationMs { get; init; }
}

/// <summary>
/// Information about an available tool.
/// </summary>
public class ToolInfo
{
    /// <summary>
    /// The server this tool belongs to.
    /// </summary>
    public required string Server { get; init; }

    /// <summary>
    /// The tool name.
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    /// The tool description.
    /// </summary>
    public string? Description { get; init; }

    /// <summary>
    /// The JSON schema for the tool's input.
    /// </summary>
    public JsonElement? InputSchema { get; init; }
}

/// <summary>
/// Globals available to code mode scripts.
/// </summary>
public class CodeModeGlobals
{
    private readonly Dictionary<string, Func<JsonElement, Task<object?>>> _toolExecutors;
    private readonly Action<string> _consoleOutput;
    private readonly ILogger? _logger;

    public CodeModeGlobals(
        Dictionary<string, Func<JsonElement, Task<object?>>> toolExecutors,
        Action<string> consoleOutput,
        ILogger? logger)
    {
        _toolExecutors = toolExecutors;
        _consoleOutput = consoleOutput;
        _logger = logger;
    }

    /// <summary>
    /// Write a line to the output.
    /// </summary>
    public void WriteLine(string message)
    {
        _consoleOutput(message);
    }

    /// <summary>
    /// Call a tool by name with the given arguments.
    /// </summary>
    public async Task<object?> CallToolAsync(string serverName, string toolName, object args)
    {
        var toolKey = $"{serverName}_{toolName}";
        if (!_toolExecutors.TryGetValue(toolKey, out var executor))
        {
            throw new InvalidOperationException($"Tool not found: {serverName}.{toolName}");
        }

        var argsJson = JsonSerializer.SerializeToElement(args);
        return await executor(argsJson);
    }

    /// <summary>
    /// Get all available tool names.
    /// </summary>
    public IEnumerable<string> GetToolNames()
    {
        return _toolExecutors.Keys;
    }
}
