using System.Text.Json;

namespace McpUse.Configuration;

/// <summary>
/// Loads MCP configuration from various sources.
/// </summary>
public static class ConfigLoader
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true
    };

    /// <summary>
    /// Load configuration from a JSON file.
    /// </summary>
    /// <param name="filePath">Path to the JSON configuration file.</param>
    /// <returns>The parsed configuration.</returns>
    /// <exception cref="FileNotFoundException">If the file doesn't exist.</exception>
    /// <exception cref="JsonException">If the JSON is invalid.</exception>
    public static McpConfiguration FromFile(string filePath)
    {
        if (!File.Exists(filePath))
        {
            throw new FileNotFoundException($"Configuration file not found: {filePath}", filePath);
        }

        var json = File.ReadAllText(filePath);
        return FromJson(json);
    }

    /// <summary>
    /// Load configuration from a JSON file asynchronously.
    /// </summary>
    /// <param name="filePath">Path to the JSON configuration file.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The parsed configuration.</returns>
    public static async Task<McpConfiguration> FromFileAsync(string filePath, CancellationToken cancellationToken = default)
    {
        if (!File.Exists(filePath))
        {
            throw new FileNotFoundException($"Configuration file not found: {filePath}", filePath);
        }

        var json = await File.ReadAllTextAsync(filePath, cancellationToken);
        return FromJson(json);
    }

    /// <summary>
    /// Load configuration from a JSON string.
    /// </summary>
    /// <param name="json">JSON string containing the configuration.</param>
    /// <returns>The parsed configuration.</returns>
    public static McpConfiguration FromJson(string json)
    {
        return JsonSerializer.Deserialize<McpConfiguration>(json, JsonOptions)
            ?? throw new JsonException("Failed to deserialize configuration");
    }

    /// <summary>
    /// Load configuration from a dictionary (programmatic configuration).
    /// </summary>
    /// <param name="config">Dictionary with mcpServers key.</param>
    /// <returns>The parsed configuration.</returns>
    public static McpConfiguration FromDictionary(Dictionary<string, object> config)
    {
        // Serialize and deserialize to handle nested objects properly
        var json = JsonSerializer.Serialize(config, JsonOptions);
        return FromJson(json);
    }

    /// <summary>
    /// Create a configuration with a single server.
    /// </summary>
    /// <param name="name">Server name.</param>
    /// <param name="serverConfig">Server configuration.</param>
    /// <returns>Configuration containing the single server.</returns>
    public static McpConfiguration FromServer(string name, McpServerConfig serverConfig)
    {
        return new McpConfiguration
        {
            McpServers = new Dictionary<string, McpServerConfig>
            {
                [name] = serverConfig
            }
        };
    }
}
