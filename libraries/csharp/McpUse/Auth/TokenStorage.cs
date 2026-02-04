using System.Text.Json;

namespace McpUse.Auth;

/// <summary>
/// Interface for token storage.
/// </summary>
public interface ITokenStorage
{
    /// <summary>
    /// Saves tokens for a server.
    /// </summary>
    Task SaveTokensAsync(string serverUrl, TokenData tokens, CancellationToken cancellationToken = default);

    /// <summary>
    /// Loads tokens for a server.
    /// </summary>
    Task<TokenData?> LoadTokensAsync(string serverUrl, CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes tokens for a server.
    /// </summary>
    Task DeleteTokensAsync(string serverUrl, CancellationToken cancellationToken = default);
}

/// <summary>
/// File-based token storage.
/// Stores OAuth tokens securely on disk.
/// </summary>
public class FileTokenStorage : ITokenStorage
{
    private readonly string _baseDirectory;
    private readonly JsonSerializerOptions _jsonOptions;

    /// <summary>
    /// Creates a new file token storage.
    /// </summary>
    /// <param name="baseDirectory">Base directory for token files. Defaults to ~/.mcp-use/tokens</param>
    public FileTokenStorage(string? baseDirectory = null)
    {
        _baseDirectory = baseDirectory ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".mcp-use",
            "tokens");

        Directory.CreateDirectory(_baseDirectory);

        _jsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            WriteIndented = true
        };
    }

    public async Task SaveTokensAsync(string serverUrl, TokenData tokens, CancellationToken cancellationToken = default)
    {
        var filePath = GetTokenFilePath(serverUrl);
        var json = JsonSerializer.Serialize(tokens, _jsonOptions);
        await File.WriteAllTextAsync(filePath, json, cancellationToken);

        // Set restrictive permissions on Unix
        if (!OperatingSystem.IsWindows())
        {
            try
            {
                File.SetUnixFileMode(filePath, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            }
            catch { }
        }
    }

    public async Task<TokenData?> LoadTokensAsync(string serverUrl, CancellationToken cancellationToken = default)
    {
        var filePath = GetTokenFilePath(serverUrl);

        if (!File.Exists(filePath))
            return null;

        try
        {
            var json = await File.ReadAllTextAsync(filePath, cancellationToken);
            return JsonSerializer.Deserialize<TokenData>(json, _jsonOptions);
        }
        catch
        {
            return null;
        }
    }

    public Task DeleteTokensAsync(string serverUrl, CancellationToken cancellationToken = default)
    {
        var filePath = GetTokenFilePath(serverUrl);

        if (File.Exists(filePath))
        {
            File.Delete(filePath);
        }

        return Task.CompletedTask;
    }

    private string GetTokenFilePath(string serverUrl)
    {
        // Create a safe filename from the URL
        var uri = new Uri(serverUrl);
        var safeName = $"{uri.Host}_{uri.Port}".Replace(":", "_").Replace("/", "_");
        return Path.Combine(_baseDirectory, $"{safeName}.json");
    }
}

/// <summary>
/// In-memory token storage.
/// Useful for testing or single-session scenarios.
/// </summary>
public class MemoryTokenStorage : ITokenStorage
{
    private readonly Dictionary<string, TokenData> _tokens = new();

    public Task SaveTokensAsync(string serverUrl, TokenData tokens, CancellationToken cancellationToken = default)
    {
        _tokens[serverUrl] = tokens;
        return Task.CompletedTask;
    }

    public Task<TokenData?> LoadTokensAsync(string serverUrl, CancellationToken cancellationToken = default)
    {
        _tokens.TryGetValue(serverUrl, out var tokens);
        return Task.FromResult(tokens);
    }

    public Task DeleteTokensAsync(string serverUrl, CancellationToken cancellationToken = default)
    {
        _tokens.Remove(serverUrl);
        return Task.CompletedTask;
    }
}
