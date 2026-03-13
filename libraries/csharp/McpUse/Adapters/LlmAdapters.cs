using System.Collections.ObjectModel;
using System.Text.Json;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using McpUse.Client;

namespace McpUse.Adapters;

/// <summary>
/// Extension methods for dictionary types.
/// </summary>
internal static class DictionaryExtensions
{
    /// <summary>
    /// Converts an IDictionary to an IReadOnlyDictionary.
    /// </summary>
    public static IReadOnlyDictionary<TKey, TValue>? AsReadOnly<TKey, TValue>(this IDictionary<TKey, TValue>? dictionary) where TKey : notnull
    {
        if (dictionary is null) return null;
        if (dictionary is IReadOnlyDictionary<TKey, TValue> readOnly) return readOnly;
        return new ReadOnlyDictionary<TKey, TValue>(dictionary);
    }
}

/// <summary>
/// Interface for adapters that convert MCP tools to other framework formats.
/// </summary>
public interface IMcpAdapter
{
    /// <summary>
    /// The target framework name.
    /// </summary>
    string Framework { get; }

    /// <summary>
    /// Disallowed tool names that should be filtered out.
    /// </summary>
    IList<string> DisallowedTools { get; set; }

    /// <summary>
    /// Create all tools, resources, and prompts from the client.
    /// </summary>
    Task CreateAllAsync(McpUseClient client, CancellationToken cancellationToken = default);

    /// <summary>
    /// Get the created tools in the target format.
    /// </summary>
    IList<object> GetTools();

    /// <summary>
    /// Execute a tool call.
    /// </summary>
    Task<string> ExecuteToolAsync(string name, IDictionary<string, object?> arguments, CancellationToken cancellationToken = default);

    /// <summary>
    /// Parse a tool result into a string.
    /// </summary>
    string ParseResult(object? result);
}

/// <summary>
/// Base adapter class with common functionality.
/// </summary>
public abstract class BaseAdapter<T> : IMcpAdapter where T : class
{
    protected readonly ILogger? Logger;
    protected readonly Dictionary<string, McpUseSession> SessionsByTool = new();
    protected readonly List<T> Tools = new();
    protected readonly List<T> Resources = new();
    protected readonly List<T> Prompts = new();

    public abstract string Framework { get; }
    public IList<string> DisallowedTools { get; set; } = new List<string>();

    protected BaseAdapter(ILogger? logger = null)
    {
        Logger = logger;
    }

    public virtual async Task CreateAllAsync(McpUseClient client, CancellationToken cancellationToken = default)
    {
        Tools.Clear();
        Resources.Clear();
        Prompts.Clear();
        SessionsByTool.Clear();

        foreach (var serverName in client.ServerNames)
        {
            var session = client.GetSession(serverName);
            if (session is null)
            {
                session = await client.CreateSessionAsync(serverName, cancellationToken);
            }

            // Create tools
            var tools = await session.ListToolsAsync(cancellationToken);
            foreach (var tool in tools.Where(t => !DisallowedTools.Contains(t.Name)))
            {
                var converted = ConvertTool(tool, session);
                if (converted is not null)
                {
                    Tools.Add(converted);
                    SessionsByTool[tool.Name] = session;
                }
            }

            // Create resources
            try
            {
                var resources = await session.ListResourcesAsync(cancellationToken);
                var convertedResources = resources
                    .Select(r => ConvertResource(r, session))
                    .Where(r => r is not null);
                foreach (var resource in convertedResources)
                {
                    Resources.Add(resource!);
                }
            }
            catch (Exception ex)
            {
                Logger?.LogWarning(ex, "Failed to list resources for {Server}", serverName);
            }

            // Create prompts
            try
            {
                var prompts = await session.ListPromptsAsync(cancellationToken);
                var convertedPrompts = prompts
                    .Select(p => ConvertPrompt(p, session))
                    .Where(p => p is not null);
                foreach (var prompt in convertedPrompts)
                {
                    Prompts.Add(prompt!);
                }
            }
            catch (Exception ex)
            {
                Logger?.LogWarning(ex, "Failed to list prompts for {Server}", serverName);
            }
        }

        Logger?.LogDebug("{Framework} adapter created: {ToolCount} tools, {ResourceCount} resources, {PromptCount} prompts",
            Framework, Tools.Count, Resources.Count, Prompts.Count);
    }

    public IList<object> GetTools() => Tools.Cast<object>().ToList();

    public virtual async Task<string> ExecuteToolAsync(string name, IDictionary<string, object?> arguments, CancellationToken cancellationToken = default)
    {
        if (!SessionsByTool.TryGetValue(name, out var session))
        {
            throw new InvalidOperationException($"No session found for tool '{name}'");
        }

        var readOnlyArgs = arguments?.AsReadOnly();
        var result = await session.CallToolAsync(name, readOnlyArgs, cancellationToken);
        return ParseResult(result);
    }

    public virtual string ParseResult(object? result)
    {
        if (result is null) return "";

        // Handle MCP tool results
        var resultType = result.GetType();

        // Check for IsError property
        var isErrorProp = resultType.GetProperty("IsError");
        if (isErrorProp?.GetValue(result) is true)
        {
            var contentProp = resultType.GetProperty("Content");
            return $"Error: {contentProp?.GetValue(result) ?? "Unknown error"}";
        }

        // Handle various result types
        var contentsProp = resultType.GetProperty("Contents"); // Resources
        if (contentsProp?.GetValue(result) is IEnumerable<object> contents)
        {
            return string.Join("\n", contents.Select(c => c?.ToString() ?? ""));
        }

        var messagesProp = resultType.GetProperty("Messages"); // Prompts
        if (messagesProp?.GetValue(result) is IEnumerable<object> messages)
        {
            return string.Join("\n", messages.Select(m => m?.ToString() ?? ""));
        }

        var contentProp2 = resultType.GetProperty("Content"); // Tools
        if (contentProp2?.GetValue(result) is object content)
        {
            return content.ToString() ?? "";
        }

        return result.ToString() ?? "";
    }

    protected abstract T? ConvertTool(ModelContextProtocol.Client.McpClientTool tool, McpUseSession session);
    protected abstract T? ConvertResource(ModelContextProtocol.Client.McpClientResource resource, McpUseSession session);
    protected abstract T? ConvertPrompt(ModelContextProtocol.Client.McpClientPrompt prompt, McpUseSession session);
}

/// <summary>
/// Adapter for OpenAI function calling format.
/// </summary>
public class OpenAIAdapter : BaseAdapter<OpenAITool>
{
    public override string Framework => "openai";

    private readonly Dictionary<string, Func<IDictionary<string, object?>, CancellationToken, Task<object?>>> _executors = new();

    public OpenAIAdapter(ILogger? logger = null) : base(logger) { }

    protected override OpenAITool? ConvertTool(ModelContextProtocol.Client.McpClientTool tool, McpUseSession session)
    {
        _executors[tool.Name] = async (args, ct) => await session.CallToolAsync(tool.Name, args?.AsReadOnly(), ct);

        return new OpenAITool
        {
            Type = "function",
            Function = new OpenAIFunction
            {
                Name = tool.Name,
                Description = tool.Description ?? "",
                Parameters = FixSchema(tool.JsonSchema)
            }
        };
    }

    protected override OpenAITool? ConvertResource(ModelContextProtocol.Client.McpClientResource resource, McpUseSession session)
    {
        var toolName = SanitizeName($"resource_{resource.Name}");
        _executors[toolName] = async (_, ct) => await session.ReadResourceAsync(resource.Uri, ct);

        return new OpenAITool
        {
            Type = "function",
            Function = new OpenAIFunction
            {
                Name = toolName,
                Description = resource.Description ?? $"Read resource: {resource.Name}",
                Parameters = JsonDocument.Parse("{\"type\":\"object\",\"properties\":{}}").RootElement
            }
        };
    }

    protected override OpenAITool? ConvertPrompt(ModelContextProtocol.Client.McpClientPrompt prompt, McpUseSession session)
    {
        _executors[prompt.Name] = async (args, ct) =>
        {
            var stringArgs = args.ToDictionary(
                kvp => kvp.Key,
                kvp => kvp.Value?.ToString() ?? "");
            return await session.GetPromptAsync(prompt.Name, stringArgs, ct);
        };

        var parameters = new Dictionary<string, object>
        {
            ["type"] = "object",
            ["properties"] = new Dictionary<string, object>()
        };

        var protocolPrompt = prompt.ProtocolPrompt;
        if (protocolPrompt.Arguments?.Any() == true)
        {
            var properties = new Dictionary<string, object>();
            var required = new List<string>();

            foreach (var arg in protocolPrompt.Arguments)
            {
                properties[arg.Name] = new Dictionary<string, object>
                {
                    ["type"] = "string",
                    ["description"] = arg.Description ?? ""
                };
                if (arg.Required == true)
                {
                    required.Add(arg.Name);
                }
            }

            parameters["properties"] = properties;
            if (required.Count > 0)
            {
                parameters["required"] = required;
            }
        }

        return new OpenAITool
        {
            Type = "function",
            Function = new OpenAIFunction
            {
                Name = prompt.Name,
                Description = prompt.Description ?? "",
                Parameters = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(parameters))
            }
        };
    }

    public async Task<object?> ExecuteAsync(string name, IDictionary<string, object?> arguments, CancellationToken cancellationToken = default)
    {
        if (!_executors.TryGetValue(name, out var executor))
        {
            throw new InvalidOperationException($"No executor found for tool '{name}'");
        }
        return await executor(arguments, cancellationToken);
    }

    private static string SanitizeName(string name)
    {
        // OpenAI tool names can only contain a-z, A-Z, 0-9, and underscores
        return System.Text.RegularExpressions.Regex.Replace(name, @"[^a-zA-Z0-9_]", "_").Trim('_')[..Math.Min(64, name.Length)];
    }

    private static JsonElement FixSchema(JsonElement schema)
    {
        // Fix JSON Schema issues for OpenAI compatibility
        var json = schema.GetRawText();

        // Convert type arrays to anyOf
        // This is a simplified fix - a full implementation would parse and transform the JSON
        return JsonDocument.Parse(json).RootElement;
    }
}

/// <summary>
/// OpenAI tool definition.
/// </summary>
public class OpenAITool
{
    public string Type { get; set; } = "function";
    public OpenAIFunction? Function { get; set; }
}

/// <summary>
/// OpenAI function definition.
/// </summary>
public class OpenAIFunction
{
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public JsonElement Parameters { get; set; }
}

/// <summary>
/// Adapter for Anthropic Claude tool format.
/// </summary>
public class AnthropicAdapter : BaseAdapter<AnthropicTool>
{
    public override string Framework => "anthropic";

    private readonly Dictionary<string, Func<IDictionary<string, object?>, CancellationToken, Task<object?>>> _executors = new();

    public AnthropicAdapter(ILogger? logger = null) : base(logger) { }

    protected override AnthropicTool? ConvertTool(ModelContextProtocol.Client.McpClientTool tool, McpUseSession session)
    {
        _executors[tool.Name] = async (args, ct) => await session.CallToolAsync(tool.Name, args?.AsReadOnly(), ct);

        return new AnthropicTool
        {
            Name = tool.Name,
            Description = tool.Description ?? "",
            InputSchema = tool.JsonSchema
        };
    }

    protected override AnthropicTool? ConvertResource(ModelContextProtocol.Client.McpClientResource resource, McpUseSession session)
    {
        var toolName = $"read_resource_{SanitizeName(resource.Name)}";
        _executors[toolName] = async (_, ct) => await session.ReadResourceAsync(resource.Uri, ct);

        return new AnthropicTool
        {
            Name = toolName,
            Description = resource.Description ?? $"Read resource: {resource.Name}",
            InputSchema = JsonDocument.Parse("{\"type\":\"object\",\"properties\":{}}").RootElement
        };
    }

    protected override AnthropicTool? ConvertPrompt(ModelContextProtocol.Client.McpClientPrompt prompt, McpUseSession session)
    {
        _executors[prompt.Name] = async (args, ct) =>
        {
            var stringArgs = args.ToDictionary(
                kvp => kvp.Key,
                kvp => kvp.Value?.ToString() ?? "");
            return await session.GetPromptAsync(prompt.Name, stringArgs, ct);
        };

        var schema = BuildPromptSchema(prompt.ProtocolPrompt);

        return new AnthropicTool
        {
            Name = prompt.Name,
            Description = prompt.Description ?? "",
            InputSchema = JsonSerializer.Deserialize<JsonElement>(JsonSerializer.Serialize(schema))
        };
    }

    public async Task<object?> ExecuteAsync(string name, IDictionary<string, object?> arguments, CancellationToken cancellationToken = default)
    {
        if (!_executors.TryGetValue(name, out var executor))
        {
            throw new InvalidOperationException($"No executor found for tool '{name}'");
        }
        return await executor(arguments, cancellationToken);
    }

    private static string SanitizeName(string name) =>
        System.Text.RegularExpressions.Regex.Replace(name, @"[^a-zA-Z0-9_]", "_").Trim('_');

    private static Dictionary<string, object> BuildPromptSchema(ModelContextProtocol.Protocol.Prompt prompt)
    {
        var schema = new Dictionary<string, object>
        {
            ["type"] = "object",
            ["properties"] = new Dictionary<string, object>()
        };

        if (prompt.Arguments?.Any() == true)
        {
            var properties = new Dictionary<string, object>();
            var required = new List<string>();

            foreach (var arg in prompt.Arguments)
            {
                properties[arg.Name] = new Dictionary<string, object>
                {
                    ["type"] = "string",
                    ["description"] = arg.Description ?? ""
                };
                if (arg.Required == true)
                {
                    required.Add(arg.Name);
                }
            }

            schema["properties"] = properties;
            if (required.Count > 0)
            {
                schema["required"] = required;
            }
        }

        return schema;
    }
}

/// <summary>
/// Anthropic tool definition.
/// </summary>
public class AnthropicTool
{
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public JsonElement InputSchema { get; set; }
}

/// <summary>
/// Adapter for Google Gemini function calling format.
/// </summary>
public class GoogleAdapter : BaseAdapter<GoogleTool>
{
    public override string Framework => "google";

    private readonly Dictionary<string, Func<IDictionary<string, object?>, CancellationToken, Task<object?>>> _executors = new();

    public GoogleAdapter(ILogger? logger = null) : base(logger) { }

    protected override GoogleTool? ConvertTool(ModelContextProtocol.Client.McpClientTool tool, McpUseSession session)
    {
        _executors[tool.Name] = async (args, ct) => await session.CallToolAsync(tool.Name, args?.AsReadOnly(), ct);

        return new GoogleTool
        {
            FunctionDeclarations = new List<GoogleFunctionDeclaration>
            {
                new()
                {
                    Name = tool.Name,
                    Description = tool.Description ?? "",
                    Parameters = ConvertToGoogleSchema(tool.JsonSchema)
                }
            }
        };
    }

    protected override GoogleTool? ConvertResource(ModelContextProtocol.Client.McpClientResource resource, McpUseSession session)
    {
        var toolName = $"read_resource_{SanitizeName(resource.Name)}";
        _executors[toolName] = async (_, ct) => await session.ReadResourceAsync(resource.Uri, ct);

        return new GoogleTool
        {
            FunctionDeclarations = new List<GoogleFunctionDeclaration>
            {
                new()
                {
                    Name = toolName,
                    Description = resource.Description ?? $"Read resource: {resource.Name}",
                    Parameters = new GoogleSchema { Type = "object", Properties = new Dictionary<string, GoogleSchema>() }
                }
            }
        };
    }

    protected override GoogleTool? ConvertPrompt(ModelContextProtocol.Client.McpClientPrompt prompt, McpUseSession session)
    {
        _executors[prompt.Name] = async (args, ct) =>
        {
            var stringArgs = args.ToDictionary(
                kvp => kvp.Key,
                kvp => kvp.Value?.ToString() ?? "");
            return await session.GetPromptAsync(prompt.Name, stringArgs, ct);
        };

        var parameters = BuildPromptParameters(prompt.ProtocolPrompt);

        return new GoogleTool
        {
            FunctionDeclarations = new List<GoogleFunctionDeclaration>
            {
                new()
                {
                    Name = prompt.Name,
                    Description = prompt.Description ?? "",
                    Parameters = parameters
                }
            }
        };
    }

    public async Task<object?> ExecuteAsync(string name, IDictionary<string, object?> arguments, CancellationToken cancellationToken = default)
    {
        if (!_executors.TryGetValue(name, out var executor))
        {
            throw new InvalidOperationException($"No executor found for tool '{name}'");
        }
        return await executor(arguments, cancellationToken);
    }

    private static string SanitizeName(string name) =>
        System.Text.RegularExpressions.Regex.Replace(name, @"[^a-zA-Z0-9_]", "_").Trim('_');

    private static GoogleSchema ConvertToGoogleSchema(JsonElement jsonSchema)
    {
        // Convert JSON Schema to Google's format
        var schema = new GoogleSchema();

        if (jsonSchema.TryGetProperty("type", out var typeProp))
        {
            schema.Type = typeProp.GetString() ?? "object";
        }

        if (jsonSchema.TryGetProperty("description", out var descProp))
        {
            schema.Description = descProp.GetString();
        }

        if (jsonSchema.TryGetProperty("properties", out var propsProp))
        {
            schema.Properties = new Dictionary<string, GoogleSchema>();
            foreach (var prop in propsProp.EnumerateObject())
            {
                schema.Properties[prop.Name] = ConvertToGoogleSchema(prop.Value);
            }
        }

        if (jsonSchema.TryGetProperty("required", out var reqProp))
        {
            schema.Required = reqProp.EnumerateArray().Select(e => e.GetString()!).ToList();
        }

        return schema;
    }

    private static GoogleSchema BuildPromptParameters(ModelContextProtocol.Protocol.Prompt prompt)
    {
        var schema = new GoogleSchema
        {
            Type = "object",
            Properties = new Dictionary<string, GoogleSchema>()
        };

        if (prompt.Arguments?.Any() == true)
        {
            var required = new List<string>();

            foreach (var arg in prompt.Arguments)
            {
                schema.Properties[arg.Name] = new GoogleSchema
                {
                    Type = "string",
                    Description = arg.Description
                };
                if (arg.Required == true)
                {
                    required.Add(arg.Name);
                }
            }

            if (required.Count > 0)
            {
                schema.Required = required;
            }
        }

        return schema;
    }
}

/// <summary>
/// Google tool definition.
/// </summary>
public class GoogleTool
{
    public List<GoogleFunctionDeclaration> FunctionDeclarations { get; set; } = new();
}

/// <summary>
/// Google function declaration.
/// </summary>
public class GoogleFunctionDeclaration
{
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public GoogleSchema? Parameters { get; set; }
}

/// <summary>
/// Google schema definition.
/// </summary>
public class GoogleSchema
{
    public string Type { get; set; } = "object";
    public string? Description { get; set; }
    public Dictionary<string, GoogleSchema>? Properties { get; set; }
    public List<string>? Required { get; set; }
    public List<string>? Enum { get; set; }
}
