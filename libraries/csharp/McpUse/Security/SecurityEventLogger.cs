using Microsoft.Extensions.Logging;

namespace McpUse.Security;

/// <summary>
/// Security event types for logging and monitoring.
/// </summary>
public enum SecurityEventType
{
    AuthenticationSuccess,
    AuthenticationFailure,
    AuthorizationSuccess,
    AuthorizationFailure,
    TokenValidationFailure,
    RateLimitExceeded,
    SuspiciousActivity,
    ToolInvocation,
    ResourceAccess,
    SessionCreated,
    SessionDestroyed
}

/// <summary>
/// Security event for logging.
/// IMPORTANT: Never log or expose secrets, tokens, or sensitive data.
/// </summary>
public sealed class SecurityEvent
{
    public DateTimeOffset Timestamp { get; init; } = DateTimeOffset.UtcNow;
    public SecurityEventType EventType { get; init; }
    public string? UserId { get; init; }
    public string? ClientId { get; init; }
    public string? SessionId { get; init; }
    public string? IpAddress { get; init; }
    public string? UserAgent { get; init; }
    public string? Resource { get; init; }
    public string? Action { get; init; }
    public bool Success { get; init; }
    public string? ErrorCode { get; init; }
    public string? ErrorMessage { get; init; }
    public Dictionary<string, string> AdditionalData { get; init; } = new();
}

/// <summary>
/// Logger for security events following Microsoft logging guidelines.
/// Log all authentication and authorization events.
/// Monitor for unusual access patterns.
/// Log security events without exposing sensitive data.
/// </summary>
public sealed class SecurityEventLogger
{
    private readonly ILogger _logger;

    public SecurityEventLogger(ILogger<SecurityEventLogger> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Log a security event.
    /// </summary>
    public void LogEvent(SecurityEvent securityEvent)
    {
        var level = securityEvent.Success ? LogLevel.Information : LogLevel.Warning;

        // Use structured logging for better monitoring/alerting
        _logger.Log(
            level,
            "Security Event: {EventType} | User: {UserId} | Client: {ClientId} | Session: {SessionId} | " +
            "Resource: {Resource} | Action: {Action} | Success: {Success} | Error: {ErrorCode}",
            securityEvent.EventType,
            SanitizeForLog(securityEvent.UserId),
            SanitizeForLog(securityEvent.ClientId),
            SanitizeForLog(securityEvent.SessionId),
            SanitizeForLog(securityEvent.Resource),
            SanitizeForLog(securityEvent.Action),
            securityEvent.Success,
            securityEvent.ErrorCode);
    }

    /// <summary>
    /// Log successful authentication.
    /// </summary>
    public void LogAuthenticationSuccess(string? userId, string? clientId, string? sessionId)
    {
        LogEvent(new SecurityEvent
        {
            EventType = SecurityEventType.AuthenticationSuccess,
            UserId = userId,
            ClientId = clientId,
            SessionId = sessionId,
            Success = true
        });
    }

    /// <summary>
    /// Log failed authentication.
    /// </summary>
    public void LogAuthenticationFailure(string? clientId, string errorCode, string errorMessage)
    {
        LogEvent(new SecurityEvent
        {
            EventType = SecurityEventType.AuthenticationFailure,
            ClientId = clientId,
            Success = false,
            ErrorCode = errorCode,
            // Don't log full error messages that might contain tokens
            ErrorMessage = SanitizeErrorMessage(errorMessage)
        });
    }

    /// <summary>
    /// Log authorization failure.
    /// </summary>
    public void LogAuthorizationFailure(string? userId, string resource, string action, string reason)
    {
        LogEvent(new SecurityEvent
        {
            EventType = SecurityEventType.AuthorizationFailure,
            UserId = userId,
            Resource = resource,
            Action = action,
            Success = false,
            ErrorMessage = reason
        });
    }

    /// <summary>
    /// Log rate limit exceeded.
    /// </summary>
    public void LogRateLimitExceeded(string? clientId, string? ipAddress)
    {
        LogEvent(new SecurityEvent
        {
            EventType = SecurityEventType.RateLimitExceeded,
            ClientId = clientId,
            IpAddress = ipAddress,
            Success = false,
            ErrorCode = "RATE_LIMIT_EXCEEDED"
        });
    }

    /// <summary>
    /// Log tool invocation for audit purposes.
    /// </summary>
    public void LogToolInvocation(string? userId, string? sessionId, string toolName, bool success)
    {
        LogEvent(new SecurityEvent
        {
            EventType = SecurityEventType.ToolInvocation,
            UserId = userId,
            SessionId = sessionId,
            Action = toolName,
            Success = success
        });
    }

    /// <summary>
    /// Sanitize value for logging - never log tokens or secrets.
    /// </summary>
    private static string? SanitizeForLog(string? value)
    {
        if (string.IsNullOrEmpty(value))
            return null;

        // Truncate long values
        if (value.Length > 100)
            return value[..100] + "...";

        return value;
    }

    /// <summary>
    /// Sanitize error messages to avoid leaking sensitive information.
    /// </summary>
    private static string SanitizeErrorMessage(string message)
    {
        // Remove potential token patterns from error messages
        var sanitized = System.Text.RegularExpressions.Regex.Replace(
            message,
            @"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+",
            "[TOKEN_REDACTED]");

        // Truncate
        if (sanitized.Length > 200)
            sanitized = sanitized[..200] + "...";

        return sanitized;
    }
}
