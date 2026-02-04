using System.Reflection;
using System.Text;
using Microsoft.CodeAnalysis.CSharp.Scripting;
using Microsoft.CodeAnalysis.Scripting;
using Microsoft.Extensions.AI;

namespace McpUse.CodeMode;

/// <summary>
/// Executes C# code with access to MCP tools in a restricted namespace.
/// Provides secure code execution with timeout and output capture.
/// </summary>
public class CodeExecutor
{
    private readonly Client.McpUseClient _client;
    private readonly CodeExecutorOptions _options;
    private ScriptOptions? _scriptOptions;
    private Dictionary<string, Func<object?, Task<string>>>? _toolFunctions;
    private IList<AIFunction>? _tools;

    /// <summary>
    /// Creates a new code executor.
    /// </summary>
    /// <param name="client">MCP client for tool access.</param>
    /// <param name="options">Execution options.</param>
    public CodeExecutor(Client.McpUseClient client, CodeExecutorOptions? options = null)
    {
        _client = client;
        _options = options ?? new CodeExecutorOptions();
    }

    /// <summary>
    /// Initializes the executor with available tools.
    /// </summary>
    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        // Build tool functions from available MCP tools
        _toolFunctions = new Dictionary<string, Func<object?, Task<string>>>();

        _tools = await _client.GetAllToolsAsync(cancellationToken);
        foreach (var tool in _tools)
        {
            var capturedTool = tool; // Capture for closure
            _toolFunctions[tool.Name] = async (args) =>
            {
                IDictionary<string, object?>? arguments = args as IDictionary<string, object?>;
                if (arguments == null && args is IReadOnlyDictionary<string, object?> roDict)
                {
                    arguments = new Dictionary<string, object?>(roDict);
                }
                arguments ??= new Dictionary<string, object?> { ["input"] = args };
                var result = await capturedTool.InvokeAsync(new AIFunctionArguments(arguments), cancellationToken);
                return result?.ToString() ?? "";
            };
        }

        // Configure script options
        _scriptOptions = ScriptOptions.Default
            .WithReferences(
                typeof(object).Assembly,
                typeof(Console).Assembly,
                typeof(Task).Assembly,
                typeof(System.Text.Json.JsonSerializer).Assembly,
                typeof(System.Linq.Enumerable).Assembly,
                typeof(List<>).Assembly)
            .WithImports(
                "System",
                "System.Collections.Generic",
                "System.Linq",
                "System.Text",
                "System.Text.Json",
                "System.Threading.Tasks");
    }

    /// <summary>
    /// Executes C# code with access to MCP tools.
    /// </summary>
    /// <param name="code">C# code to execute.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Execution result.</returns>
    public async Task<CodeExecutionResult> ExecuteAsync(string code, CancellationToken cancellationToken = default)
    {
        if (_scriptOptions == null || _toolFunctions == null)
        {
            await InitializeAsync(cancellationToken);
        }

        var startTime = DateTime.UtcNow;
        var logs = new List<string>();

        try
        {
            // Create globals with tool access
            var globals = new CodeExecutionGlobals
            {
                Tools = _toolFunctions!,
                Log = (message) => logs.Add(message)
            };

            // Wrap code to capture return value
            var wrappedCode = WrapCode(code);

            // Execute with timeout
            using var timeoutCts = new CancellationTokenSource(_options.Timeout);
            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);

            try
            {
                var scriptResult = await CSharpScript.EvaluateAsync<object?>(
                    wrappedCode,
                    _scriptOptions,
                    globals,
                    typeof(CodeExecutionGlobals),
                    linkedCts.Token);

                return new CodeExecutionResult
                {
                    Success = true,
                    Result = scriptResult,
                    Output = string.Join("\n", logs),
                    DurationMs = (int)(DateTime.UtcNow - startTime).TotalMilliseconds
                };
            }
            catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested)
            {
                return new CodeExecutionResult
                {
                    Success = false,
                    Error = $"Execution timeout after {_options.Timeout.TotalSeconds} seconds",
                    Output = string.Join("\n", logs),
                    DurationMs = (int)(DateTime.UtcNow - startTime).TotalMilliseconds
                };
            }
        }
        catch (CompilationErrorException ex)
        {
            return new CodeExecutionResult
            {
                Success = false,
                Error = $"Compilation error: {string.Join("\n", ex.Diagnostics.Select(d => d.ToString()))}",
                Output = string.Join("\n", logs),
                DurationMs = (int)(DateTime.UtcNow - startTime).TotalMilliseconds
            };
        }
        catch (Exception ex)
        {
            return new CodeExecutionResult
            {
                Success = false,
                Error = ex.Message,
                Output = string.Join("\n", logs),
                DurationMs = (int)(DateTime.UtcNow - startTime).TotalMilliseconds
            };
        }
    }

    /// <summary>
    /// Generates tool function signatures for the AI to use.
    /// </summary>
    public async Task<string> GenerateToolApiDocumentationAsync(CancellationToken cancellationToken = default)
    {
        var tools = await _client.GetAllToolsAsync(cancellationToken);
        var sb = new StringBuilder();

        sb.AppendLine("// Available tool functions in the execution environment:");
        sb.AppendLine();

        foreach (var tool in tools)
        {
            sb.AppendLine($"// {tool.Description}");
            sb.AppendLine($"async Task<string> {SanitizeName(tool.Name)}(object? arguments)");
            sb.AppendLine();
        }

        sb.AppendLine("// Helper functions:");
        sb.AppendLine("void Log(string message) // Logs a message");
        sb.AppendLine();

        return sb.ToString();
    }

    private string WrapCode(string code)
    {
        // Generate tool function definitions
        var toolDefs = new StringBuilder();
        foreach (var (name, _) in _toolFunctions!)
        {
            var safeName = SanitizeName(name);
            toolDefs.AppendLine($"Func<object?, Task<string>> {safeName} = Tools[\"{name}\"];");
        }

        return $@"
{toolDefs}

// User code:
{code}
";
    }

    private static string SanitizeName(string name)
    {
        // Convert tool names to valid C# identifiers
        return name
            .Replace("-", "_")
            .Replace(".", "_")
            .Replace(" ", "_");
    }
}

/// <summary>
/// Options for code execution.
/// </summary>
public class CodeExecutorOptions
{
    /// <summary>
    /// Execution timeout (default: 30 seconds).
    /// </summary>
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Maximum output size in characters (default: 100000).
    /// </summary>
    public int MaxOutputSize { get; set; } = 100000;

    /// <summary>
    /// Whether to allow file system access (default: false).
    /// </summary>
    public bool AllowFileSystem { get; set; } = false;

    /// <summary>
    /// Whether to allow network access (default: false).
    /// </summary>
    public bool AllowNetwork { get; set; } = false;
}

/// <summary>
/// Globals available during code execution.
/// </summary>
public class CodeExecutionGlobals
{
    /// <summary>
    /// Dictionary of tool functions.
    /// </summary>
    public Dictionary<string, Func<object?, Task<string>>> Tools { get; set; } = new();

    /// <summary>
    /// Logging function.
    /// </summary>
    public Action<string> Log { get; set; } = _ => { };
}

// CodeExecutionResult is defined in CodeModeConnector.cs
