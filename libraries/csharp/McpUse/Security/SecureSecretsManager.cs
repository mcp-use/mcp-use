using Azure.Identity;
using Azure.Security.KeyVault.Secrets;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace McpUse.Security;

/// <summary>
/// Secure secrets management using Azure Key Vault.
/// Following Microsoft guidelines: Store secrets securely (Azure Key Vault) 
/// and do not embed them in MCP server code.
/// </summary>
public sealed class SecureSecretsManager : IAsyncDisposable
{
    private readonly SecretClient? _keyVaultClient;
    private readonly ILogger<SecureSecretsManager> _logger;
    private readonly Dictionary<string, CachedSecret> _secretCache = new();
    private readonly SemaphoreSlim _cacheLock = new(1, 1);
    private readonly TimeSpan _cacheExpiration;
    private bool _disposed;

    /// <summary>
    /// Creates a secrets manager using Azure Key Vault.
    /// </summary>
    /// <param name="keyVaultUri">The Key Vault URI (e.g., https://myvault.vault.azure.net/).</param>
    /// <param name="cacheExpirationMinutes">How long to cache secrets (default: 30 minutes).</param>
    /// <param name="logger">Optional logger.</param>
    public SecureSecretsManager(
        string keyVaultUri,
        int cacheExpirationMinutes = 30,
        ILogger<SecureSecretsManager>? logger = null)
    {
        _logger = logger ?? NullLogger<SecureSecretsManager>.Instance;
        _cacheExpiration = TimeSpan.FromMinutes(cacheExpirationMinutes);

        if (!string.IsNullOrWhiteSpace(keyVaultUri))
        {
            // Use DefaultAzureCredential for flexible authentication
            // Works with managed identity, Azure CLI, VS credentials, etc.
            var credential = new DefaultAzureCredential();
            _keyVaultClient = new SecretClient(new Uri(keyVaultUri), credential);
            _logger.LogInformation("Initialized Key Vault client for: {KeyVaultUri}",
                MaskUri(keyVaultUri));
        }
        else
        {
            _logger.LogWarning("No Key Vault URI provided - secrets must be provided via configuration");
        }
    }

    /// <summary>
    /// Get a secret value from Azure Key Vault.
    /// </summary>
    /// <param name="secretName">The name of the secret.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The secret value.</returns>
    /// <exception cref="McpSecurityException">If secret cannot be retrieved.</exception>
    public async Task<string> GetSecretAsync(string secretName, CancellationToken cancellationToken = default)
    {
        if (_disposed) throw new ObjectDisposedException(nameof(SecureSecretsManager));

        if (_keyVaultClient is null)
            throw new McpSecurityException("Key Vault not configured. Provide keyVaultUri in constructor.");

        // Check cache first
        await _cacheLock.WaitAsync(cancellationToken);
        try
        {
            if (_secretCache.TryGetValue(secretName, out var cached) && !cached.IsExpired)
            {
                return cached.Value;
            }
        }
        finally
        {
            _cacheLock.Release();
        }

        // Fetch from Key Vault
        try
        {
            _logger.LogDebug("Fetching secret from Key Vault: {SecretName}", secretName);

            var response = await _keyVaultClient.GetSecretAsync(secretName, cancellationToken: cancellationToken);
            var secretValue = response.Value.Value;

            // Cache the secret
            await _cacheLock.WaitAsync(cancellationToken);
            try
            {
                _secretCache[secretName] = new CachedSecret(secretValue, _cacheExpiration);
            }
            finally
            {
                _cacheLock.Release();
            }

            return secretValue;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to retrieve secret: {SecretName}", secretName);
            throw new McpSecurityException($"Failed to retrieve secret '{secretName}' from Key Vault", ex);
        }
    }

    /// <summary>
    /// Invalidate a cached secret (e.g., on rotation).
    /// </summary>
    /// <param name="secretName">The secret name to invalidate.</param>
    public async Task InvalidateSecretAsync(string secretName)
    {
        await _cacheLock.WaitAsync();
        try
        {
            _secretCache.Remove(secretName);
            _logger.LogInformation("Invalidated cached secret: {SecretName}", secretName);
        }
        finally
        {
            _cacheLock.Release();
        }
    }

    /// <summary>
    /// Clear all cached secrets.
    /// </summary>
    public async Task ClearCacheAsync()
    {
        await _cacheLock.WaitAsync();
        try
        {
            _secretCache.Clear();
            _logger.LogInformation("Cleared all cached secrets");
        }
        finally
        {
            _cacheLock.Release();
        }
    }

    private static string MaskUri(string uri)
    {
        try
        {
            var u = new Uri(uri);
            return $"{u.Scheme}://{u.Host}/***";
        }
        catch
        {
            return "***";
        }
    }

    /// <inheritdoc />
    public ValueTask DisposeAsync()
    {
        if (_disposed) return ValueTask.CompletedTask;
        _disposed = true;

        _secretCache.Clear();
        _cacheLock.Dispose();

        return ValueTask.CompletedTask;
    }

    private sealed class CachedSecret
    {
        public string Value { get; }
        private readonly DateTimeOffset _expiresAt;

        public CachedSecret(string value, TimeSpan expiration)
        {
            Value = value;
            _expiresAt = DateTimeOffset.UtcNow.Add(expiration);
        }

        public bool IsExpired => DateTimeOffset.UtcNow >= _expiresAt;
    }
}
