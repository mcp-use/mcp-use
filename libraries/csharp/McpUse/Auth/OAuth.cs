using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using McpUse.Connectors;

namespace McpUse.Auth;

/// <summary>
/// OAuth 2.0 authentication provider with PKCE and Dynamic Client Registration support.
/// </summary>
public class OAuth : IHttpAuth
{
    private readonly OAuthConfig _config;
    private readonly ITokenStorage _tokenStorage;
    private readonly HttpClient _httpClient;
    private readonly JsonSerializerOptions _jsonOptions;

    private OAuthMetadata? _metadata;
    private ClientRegistration? _clientRegistration;
    private TokenData? _tokens;

    /// <summary>
    /// Creates a new OAuth authentication provider.
    /// </summary>
    /// <param name="config">OAuth configuration.</param>
    /// <param name="tokenStorage">Optional token storage (defaults to file-based).</param>
    public OAuth(OAuthConfig config, ITokenStorage? tokenStorage = null)
    {
        _config = config ?? throw new ArgumentNullException(nameof(config));
        _tokenStorage = tokenStorage ?? new FileTokenStorage();
        _httpClient = new HttpClient();
        _jsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            PropertyNameCaseInsensitive = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };
    }

    /// <summary>
    /// Applies OAuth authentication to the HTTP client.
    /// </summary>
    public async Task ApplyAsync(HttpClient client, CancellationToken cancellationToken = default)
    {
        var token = await GetAccessTokenAsync(cancellationToken);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }

    /// <summary>
    /// Gets a valid access token, refreshing if necessary.
    /// </summary>
    public async Task<string> GetAccessTokenAsync(CancellationToken cancellationToken = default)
    {
        // Try to load cached tokens
        _tokens ??= await _tokenStorage.LoadTokensAsync(_config.ServerUrl, cancellationToken);

        if (_tokens != null)
        {
            // Check if token is still valid
            if (_tokens.ExpiresAt == null || _tokens.ExpiresAt > DateTimeOffset.UtcNow.ToUnixTimeSeconds())
            {
                return _tokens.AccessToken;
            }

            // Try to refresh
            if (_tokens.RefreshToken != null)
            {
                try
                {
                    await RefreshTokenAsync(cancellationToken);
                    return _tokens!.AccessToken;
                }
                catch
                {
                    // Refresh failed, need to re-authenticate
                }
            }
        }

        // Need to authenticate
        await AuthenticateAsync(cancellationToken);
        return _tokens!.AccessToken;
    }

    /// <summary>
    /// Performs the OAuth authentication flow.
    /// </summary>
    public async Task AuthenticateAsync(CancellationToken cancellationToken = default)
    {
        // Discover OAuth metadata
        await DiscoverMetadataAsync(cancellationToken);

        // Register client if needed (Dynamic Client Registration)
        if (_config.ClientId == null && _metadata!.RegistrationEndpoint != null)
        {
            await RegisterClientAsync(cancellationToken);
        }

        // Generate PKCE challenge
        var (codeVerifier, codeChallenge) = GeneratePkceChallenge();

        // Generate state for CSRF protection
        var state = GenerateRandomString(32);

        // Build authorization URL
        var authUrl = BuildAuthorizationUrl(codeChallenge, state);

        // Start local callback server
        using var callbackServer = new OAuthCallbackServer(_config.RedirectUri);
        await callbackServer.StartAsync(cancellationToken);

        // Open browser for user authentication
        OpenBrowser(authUrl);

        // Wait for callback
        var callbackResult = await callbackServer.WaitForCallbackAsync(cancellationToken);

        if (callbackResult.State != state)
        {
            throw new OAuthException("State mismatch - possible CSRF attack");
        }

        if (callbackResult.Error != null)
        {
            throw new OAuthException($"OAuth error: {callbackResult.Error} - {callbackResult.ErrorDescription}");
        }

        // Exchange code for tokens
        await ExchangeCodeForTokensAsync(callbackResult.Code!, codeVerifier, cancellationToken);
    }

    /// <summary>
    /// Revokes the current tokens.
    /// </summary>
    public async Task RevokeAsync(CancellationToken cancellationToken = default)
    {
        if (_tokens == null || _metadata?.RevocationEndpoint == null)
            return;

        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["token"] = _tokens.AccessToken,
            ["client_id"] = _config.ClientId ?? _clientRegistration?.ClientId ?? ""
        });

        await _httpClient.PostAsync(_metadata.RevocationEndpoint, content, cancellationToken);

        _tokens = null;
        await _tokenStorage.DeleteTokensAsync(_config.ServerUrl, cancellationToken);
    }

    private async Task DiscoverMetadataAsync(CancellationToken cancellationToken)
    {
        if (_metadata != null)
            return;

        // Try well-known endpoint
        var metadataUrl = $"{_config.ServerUrl.TrimEnd('/')}/.well-known/oauth-authorization-server";

        try
        {
            var response = await _httpClient.GetAsync(metadataUrl, cancellationToken);
            if (response.IsSuccessStatusCode)
            {
                var json = await response.Content.ReadAsStringAsync(cancellationToken);
                _metadata = JsonSerializer.Deserialize<OAuthMetadata>(json, _jsonOptions);
                return;
            }
        }
        catch
        {
            // Metadata not available at well-known endpoint, will try OpenID Connect discovery next
        }

        // Try OpenID Connect discovery
        metadataUrl = $"{_config.ServerUrl.TrimEnd('/')}/.well-known/openid-configuration";

        try
        {
            var response = await _httpClient.GetAsync(metadataUrl, cancellationToken);
            if (response.IsSuccessStatusCode)
            {
                var json = await response.Content.ReadAsStringAsync(cancellationToken);
                _metadata = JsonSerializer.Deserialize<OAuthMetadata>(json, _jsonOptions);
                return;
            }
        }
        catch
        {
            // OpenID Connect discovery also failed, will throw below
        }

        throw new OAuthException($"Failed to discover OAuth metadata for {_config.ServerUrl}");
    }

    private async Task RegisterClientAsync(CancellationToken cancellationToken)
    {
        if (_metadata?.RegistrationEndpoint == null)
            throw new OAuthException("Dynamic Client Registration not supported");

        var request = new
        {
            client_name = _config.ClientName ?? "MCP-Use C# Client",
            redirect_uris = new[] { _config.RedirectUri },
            grant_types = new[] { "authorization_code", "refresh_token" },
            response_types = new[] { "code" },
            token_endpoint_auth_method = "none" // Public client
        };

        using var content = new StringContent(
            JsonSerializer.Serialize(request, _jsonOptions),
            Encoding.UTF8,
            "application/json");

        var response = await _httpClient.PostAsync(_metadata.RegistrationEndpoint, content, cancellationToken);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync(cancellationToken);
        _clientRegistration = JsonSerializer.Deserialize<ClientRegistration>(json, _jsonOptions);
    }

    private string BuildAuthorizationUrl(string codeChallenge, string state)
    {
        var clientId = _config.ClientId ?? _clientRegistration?.ClientId
            ?? throw new OAuthException("No client ID available");

        var query = new Dictionary<string, string>
        {
            ["response_type"] = "code",
            ["client_id"] = clientId,
            ["redirect_uri"] = _config.RedirectUri,
            ["state"] = state,
            ["code_challenge"] = codeChallenge,
            ["code_challenge_method"] = "S256"
        };

        if (_config.Scope != null)
        {
            query["scope"] = _config.Scope;
        }

        var queryString = string.Join("&", query.Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}"));
        return $"{_metadata!.AuthorizationEndpoint}?{queryString}";
    }

    private async Task ExchangeCodeForTokensAsync(string code, string codeVerifier, CancellationToken cancellationToken)
    {
        var clientId = _config.ClientId ?? _clientRegistration?.ClientId
            ?? throw new OAuthException("No client ID available");

        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = _config.RedirectUri,
            ["client_id"] = clientId,
            ["code_verifier"] = codeVerifier
        });

        var response = await _httpClient.PostAsync(_metadata!.TokenEndpoint, content, cancellationToken);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync(cancellationToken);
        _tokens = JsonSerializer.Deserialize<TokenData>(json, _jsonOptions);

        await _tokenStorage.SaveTokensAsync(_config.ServerUrl, _tokens!, cancellationToken);
    }

    private async Task RefreshTokenAsync(CancellationToken cancellationToken)
    {
        if (_tokens?.RefreshToken == null || _metadata?.TokenEndpoint == null)
            throw new OAuthException("Cannot refresh token");

        var clientId = _config.ClientId ?? _clientRegistration?.ClientId
            ?? throw new OAuthException("No client ID available");

        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = _tokens.RefreshToken,
            ["client_id"] = clientId
        });

        var response = await _httpClient.PostAsync(_metadata.TokenEndpoint, content, cancellationToken);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync(cancellationToken);
        _tokens = JsonSerializer.Deserialize<TokenData>(json, _jsonOptions);

        await _tokenStorage.SaveTokensAsync(_config.ServerUrl, _tokens!, cancellationToken);
    }

    private static (string verifier, string challenge) GeneratePkceChallenge()
    {
        var verifier = GenerateRandomString(64);
        var bytes = SHA256.HashData(Encoding.ASCII.GetBytes(verifier));
        var challenge = Base64UrlEncode(bytes);
        return (verifier, challenge);
    }

    private static string GenerateRandomString(int length)
    {
        const string chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
        var bytes = new byte[length];
        RandomNumberGenerator.Fill(bytes);
        return new string(bytes.Select(b => chars[b % chars.Length]).ToArray());
    }

    private static string Base64UrlEncode(byte[] bytes)
    {
        return Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }

    private static void OpenBrowser(string url)
    {
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true
            });
        }
        catch
        {
            // Fallback for different platforms
            if (OperatingSystem.IsWindows())
            {
                System.Diagnostics.Process.Start("cmd", $"/c start {url}");
            }
            else if (OperatingSystem.IsMacOS())
            {
                System.Diagnostics.Process.Start("open", url);
            }
            else if (OperatingSystem.IsLinux())
            {
                System.Diagnostics.Process.Start("xdg-open", url);
            }
        }
    }
}

/// <summary>
/// OAuth configuration.
/// </summary>
public class OAuthConfig
{
    /// <summary>
    /// The OAuth server URL.
    /// </summary>
    public required string ServerUrl { get; set; }

    /// <summary>
    /// OAuth client ID (optional if DCR is used).
    /// </summary>
    public string? ClientId { get; set; }

    /// <summary>
    /// OAuth client secret (optional for public clients).
    /// </summary>
    public string? ClientSecret { get; set; }

    /// <summary>
    /// OAuth scopes to request.
    /// </summary>
    public string? Scope { get; set; }

    /// <summary>
    /// Redirect URI for OAuth callback (default: http://localhost:8765/callback).
    /// </summary>
    public string RedirectUri { get; set; } = "http://localhost:8765/callback";

    /// <summary>
    /// Client name for DCR.
    /// </summary>
    public string? ClientName { get; set; }
}

/// <summary>
/// OAuth metadata from server discovery.
/// </summary>
public class OAuthMetadata
{
    public string? Issuer { get; set; }
    public required string AuthorizationEndpoint { get; set; }
    public required string TokenEndpoint { get; set; }
    public string? UserinfoEndpoint { get; set; }
    public string? RevocationEndpoint { get; set; }
    public string? RegistrationEndpoint { get; set; }
    public string? JwksUri { get; set; }
    public string[]? ScopesSupported { get; set; }
    public string[]? ResponseTypesSupported { get; set; }
    public string[]? CodeChallengeMethodsSupported { get; set; }
}

/// <summary>
/// OAuth token data.
/// </summary>
public class TokenData
{
    public required string AccessToken { get; set; }
    public string TokenType { get; set; } = "Bearer";
    public long? ExpiresAt { get; set; }
    public long? ExpiresIn { get; set; }
    public string? RefreshToken { get; set; }
    public string? Scope { get; set; }
}

/// <summary>
/// Dynamic Client Registration response.
/// </summary>
public class ClientRegistration
{
    public required string ClientId { get; set; }
    public string? ClientSecret { get; set; }
    public long? ClientIdIssuedAt { get; set; }
    public long? ClientSecretExpiresAt { get; set; }
    public string[]? RedirectUris { get; set; }
}

/// <summary>
/// OAuth exception.
/// </summary>
public class OAuthException : Exception
{
    public OAuthException(string message) : base(message) { }
    public OAuthException(string message, Exception inner) : base(message, inner) { }
}
