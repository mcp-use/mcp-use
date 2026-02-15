using System.Text.Json.Serialization;

namespace McpUse.Configuration;

/// <summary>
/// Root configuration object matching Claude Desktop format.
/// </summary>
public sealed class McpConfiguration
{
    /// <summary>
    /// Dictionary of MCP server configurations keyed by server name.
    /// </summary>
    [JsonPropertyName("mcpServers")]
    public Dictionary<string, McpServerConfig> McpServers { get; set; } = new();
}

/// <summary>
/// Configuration for a single MCP server.
/// </summary>
public sealed class McpServerConfig
{
    /// <summary>
    /// Command to execute for stdio transport (e.g., "dotnet", "node", "python").
    /// </summary>
    [JsonPropertyName("command")]
    public string? Command { get; set; }

    /// <summary>
    /// Arguments to pass to the command.
    /// </summary>
    [JsonPropertyName("args")]
    public List<string>? Args { get; set; }

    /// <summary>
    /// Environment variables to set for the server process.
    /// </summary>
    [JsonPropertyName("env")]
    public Dictionary<string, string>? Env { get; set; }

    /// <summary>
    /// URL for HTTP/SSE transport (mutually exclusive with command).
    /// </summary>
    [JsonPropertyName("url")]
    public string? Url { get; set; }

    /// <summary>
    /// Custom headers for HTTP transport.
    /// </summary>
    [JsonPropertyName("headers")]
    public Dictionary<string, string>? Headers { get; set; }

    /// <summary>
    /// Whether this server is enabled (default: true).
    /// </summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Determines if this is a stdio-based server.
    /// </summary>
    [JsonIgnore]
    public bool IsStdio => !string.IsNullOrEmpty(Command);

    /// <summary>
    /// Determines if this is an HTTP-based server.
    /// </summary>
    [JsonIgnore]
    public bool IsHttp => !string.IsNullOrEmpty(Url);
}
