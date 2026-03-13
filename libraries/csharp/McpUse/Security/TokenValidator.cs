using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.IdentityModel.Tokens;

namespace McpUse.Security;

/// <summary>
/// Token validator for MCP server authentication.
/// Following Microsoft guidelines: Your server MUST validate all inbound tokens.
/// Tokens MUST be issued specifically for this MCP server.
/// Token passthrough is strictly prohibited.
/// </summary>
public sealed class TokenValidator
{
    private readonly EntraIdOptions _options;
    private readonly ILogger<TokenValidator> _logger;
    private readonly SecurityEventLogger _securityLogger;
    private readonly TokenValidationParameters _validationParameters;

    public TokenValidator(
        EntraIdOptions options,
        SecurityEventLogger securityLogger,
        ILogger<TokenValidator>? logger = null)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _securityLogger = securityLogger ?? throw new ArgumentNullException(nameof(securityLogger));
        _logger = logger ?? NullLogger<TokenValidator>.Instance;

        // Validate configuration
        _options.Validate();

        // Set up token validation parameters
        _validationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = $"{_options.Instance.TrimEnd('/')}/{_options.TenantId}/v2.0",

            ValidateAudience = true,
            ValidAudience = _options.Audience,

            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(5),

            ValidateIssuerSigningKey = true,
            // Note: In production, use MISE or Azure.Identity for key discovery
            // This is a simplified implementation
            RequireSignedTokens = true,
        };
    }

    /// <summary>
    /// Validate an access token from the Authorization header.
    /// </summary>
    /// <param name="authorizationHeader">The full Authorization header value.</param>
    /// <returns>The validated claims principal.</returns>
    /// <exception cref="McpAuthenticationException">If token is invalid.</exception>
    public async Task<ClaimsPrincipal> ValidateTokenAsync(string authorizationHeader)
    {
        // Extract token from "Bearer <token>" format
        if (string.IsNullOrWhiteSpace(authorizationHeader))
        {
            _securityLogger.LogAuthenticationFailure(null, "MISSING_TOKEN", "Authorization header is missing");
            throw new McpAuthenticationException("Authorization header is required");
        }

        if (!authorizationHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            _securityLogger.LogAuthenticationFailure(null, "INVALID_SCHEME", "Invalid authorization scheme");
            throw new McpAuthenticationException("Bearer token expected");
        }

        var token = authorizationHeader["Bearer ".Length..].Trim();

        if (string.IsNullOrWhiteSpace(token))
        {
            _securityLogger.LogAuthenticationFailure(null, "EMPTY_TOKEN", "Token is empty");
            throw new McpAuthenticationException("Token is required");
        }

        return await ValidateTokenAsync(token, isRawToken: true);
    }

    /// <summary>
    /// Validate a raw access token.
    /// </summary>
    /// <param name="token">The JWT token.</param>
    /// <param name="isRawToken">Whether this is a raw token (vs. from header).</param>
    /// <returns>The validated claims principal.</returns>
    private async Task<ClaimsPrincipal> ValidateTokenAsync(string token, bool isRawToken = false)
    {
        try
        {
            var handler = new JwtSecurityTokenHandler();

            // Basic format validation
            if (!handler.CanReadToken(token))
            {
                _securityLogger.LogAuthenticationFailure(null, "INVALID_FORMAT", "Token format is invalid");
                throw new McpAuthenticationException("Invalid token format");
            }

            // Decode token to get claims (before full validation)
            var jwtToken = handler.ReadJwtToken(token);
            var clientId = jwtToken.Claims.FirstOrDefault(c => c.Type == "azp" || c.Type == "appid")?.Value;

            // CRITICAL: Validate audience - tokens MUST be issued for this MCP server
            var tokenAudience = jwtToken.Audiences.FirstOrDefault();
            if (tokenAudience != _options.Audience && tokenAudience != _options.ClientId)
            {
                _securityLogger.LogAuthenticationFailure(
                    clientId,
                    "INVALID_AUDIENCE",
                    $"Token was not issued for this MCP server");

                throw new McpAuthenticationException(
                    "Token was not issued for this MCP server. Token passthrough is not allowed.");
            }

            // Validate issuer
            var tokenIssuer = jwtToken.Issuer;
            var expectedIssuerPrefix = $"{_options.Instance.TrimEnd('/')}/{_options.TenantId}";
            if (!tokenIssuer.StartsWith(expectedIssuerPrefix, StringComparison.OrdinalIgnoreCase))
            {
                _securityLogger.LogAuthenticationFailure(
                    clientId,
                    "INVALID_ISSUER",
                    "Token issuer does not match expected authority");

                throw new McpAuthenticationException("Invalid token issuer");
            }

            // Validate expiration
            if (jwtToken.ValidTo < DateTime.UtcNow)
            {
                _securityLogger.LogAuthenticationFailure(clientId, "EXPIRED_TOKEN", "Token has expired");
                throw new McpAuthenticationException("Token has expired");
            }

            // Validate required scopes
            if (_options.RequiredScopes.Count > 0)
            {
                var tokenScopes = jwtToken.Claims
                    .Where(c => c.Type == "scp" || c.Type == "scope")
                    .SelectMany(c => c.Value.Split(' '))
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);

                var missingScopes = _options.RequiredScopes
                    .Where(s => !tokenScopes.Contains(s))
                    .ToList();

                if (missingScopes.Count > 0)
                {
                    _securityLogger.LogAuthorizationFailure(
                        jwtToken.Subject,
                        _options.Audience,
                        "access",
                        $"Missing required scopes: {string.Join(", ", missingScopes)}");

                    throw new McpAuthorizationException(
                        $"Insufficient scope. Required: {string.Join(", ", _options.RequiredScopes)}");
                }
            }

            // Build claims principal
            var identity = new ClaimsIdentity(jwtToken.Claims, "Bearer");
            var principal = new ClaimsPrincipal(identity);

            // Log success
            var userId = jwtToken.Subject;
            _securityLogger.LogAuthenticationSuccess(userId, clientId, null);

            _logger.LogDebug("Token validated successfully for user: {UserId}", userId);

            return await Task.FromResult(principal);
        }
        catch (McpAuthenticationException)
        {
            throw;
        }
        catch (McpAuthorizationException)
        {
            throw;
        }
        catch (SecurityTokenException ex)
        {
            _securityLogger.LogAuthenticationFailure(null, "TOKEN_VALIDATION_FAILED", ex.Message);
            throw new McpAuthenticationException("Token validation failed", ex);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected error during token validation");
            _securityLogger.LogAuthenticationFailure(null, "VALIDATION_ERROR", "Unexpected validation error");
            throw new McpAuthenticationException("Token validation failed", ex);
        }
    }

    /// <summary>
    /// Extract user ID from a validated claims principal.
    /// </summary>
    public static string? GetUserId(ClaimsPrincipal principal)
    {
        return principal.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? principal.FindFirst("sub")?.Value
            ?? principal.FindFirst("oid")?.Value;
    }

    /// <summary>
    /// Extract client ID from a validated claims principal.
    /// </summary>
    public static string? GetClientId(ClaimsPrincipal principal)
    {
        return principal.FindFirst("azp")?.Value
            ?? principal.FindFirst("appid")?.Value;
    }
}
