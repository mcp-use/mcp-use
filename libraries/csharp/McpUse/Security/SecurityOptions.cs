namespace McpUse.Security;

/// <summary>
/// Configuration for Entra ID (Azure AD) authentication.
/// Following Microsoft security guidelines for MCP servers.
/// </summary>
public sealed class EntraIdOptions
{
    /// <summary>
    /// The Azure AD tenant ID (directory ID).
    /// </summary>
    public string TenantId { get; set; } = string.Empty;

    /// <summary>
    /// The client/application ID for this MCP server.
    /// IMPORTANT: Each MCP server MUST have its own dedicated Entra ID application.
    /// Do not reuse a single app registration for multiple servers.
    /// </summary>
    public string ClientId { get; set; } = string.Empty;

    /// <summary>
    /// The client secret (for confidential client flows).
    /// IMPORTANT: Store secrets in Azure Key Vault, not in code or config files.
    /// </summary>
    public string? ClientSecret { get; set; }

    /// <summary>
    /// The Azure AD instance URL (default: https://login.microsoftonline.com/).
    /// </summary>
    public string Instance { get; set; } = "https://login.microsoftonline.com/";

    /// <summary>
    /// The audience (resource) for token validation.
    /// Tokens MUST be issued specifically for this MCP server.
    /// </summary>
    public string Audience { get; set; } = string.Empty;

    /// <summary>
    /// Required scopes for accessing this MCP server.
    /// Define only the scopes specific for this server.
    /// </summary>
    public List<string> RequiredScopes { get; set; } = new();

    /// <summary>
    /// The authority URL constructed from Instance and TenantId.
    /// </summary>
    public string Authority => $"{Instance.TrimEnd('/')}/{TenantId}";

    /// <summary>
    /// Validates the configuration is complete.
    /// </summary>
    /// <exception cref="McpSecurityException">If configuration is invalid.</exception>
    public void Validate()
    {
        var errors = new List<string>();

        if (string.IsNullOrWhiteSpace(TenantId))
            errors.Add("TenantId is required");

        if (string.IsNullOrWhiteSpace(ClientId))
            errors.Add("ClientId is required");

        if (string.IsNullOrWhiteSpace(Audience))
            errors.Add("Audience is required for token validation");

        if (errors.Count > 0)
            throw new McpSecurityException($"Invalid EntraIdOptions: {string.Join(", ", errors)}");
    }
}

/// <summary>
/// Options for HTTP transport security.
/// </summary>
public sealed class HttpTransportSecurityOptions
{
    /// <summary>
    /// Require HTTPS in production (default: true).
    /// All endpoints MUST use HTTPS in production environments.
    /// </summary>
    public bool RequireHttps { get; set; } = true;

    /// <summary>
    /// Enable rate limiting (default: true).
    /// </summary>
    public bool EnableRateLimiting { get; set; } = true;

    /// <summary>
    /// Maximum requests per minute per client (default: 60).
    /// </summary>
    public int RateLimitRequestsPerMinute { get; set; } = 60;

    /// <summary>
    /// Enable request logging for security events (default: true).
    /// </summary>
    public bool EnableSecurityLogging { get; set; } = true;

    /// <summary>
    /// Allowed origins for CORS (empty = same-origin only).
    /// </summary>
    public List<string> AllowedOrigins { get; set; } = new();
}
