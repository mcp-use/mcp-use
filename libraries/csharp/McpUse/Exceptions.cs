namespace McpUse;

/// <summary>
/// Base exception for mcp-use library errors.
/// </summary>
public class McpUseException : Exception
{
    public McpUseException(string message) : base(message) { }
    public McpUseException(string message, Exception innerException) : base(message, innerException) { }
}

/// <summary>
/// Exception thrown when configuration is invalid.
/// </summary>
public class McpConfigurationException : McpUseException
{
    public McpConfigurationException(string message) : base(message) { }
    public McpConfigurationException(string message, Exception innerException) : base(message, innerException) { }
}

/// <summary>
/// Exception thrown when a server connection fails.
/// </summary>
public class McpConnectionException : McpUseException
{
    public string? ServerName { get; }

    public McpConnectionException(string serverName, string message)
        : base(message)
    {
        ServerName = serverName;
    }

    public McpConnectionException(string serverName, string message, Exception innerException)
        : base(message, innerException)
    {
        ServerName = serverName;
    }
}

/// <summary>
/// Exception thrown when a tool invocation fails.
/// </summary>
public class McpToolException : McpUseException
{
    public string? ToolName { get; }
    public string? ServerName { get; }

    public McpToolException(string toolName, string serverName, string message)
        : base(message)
    {
        ToolName = toolName;
        ServerName = serverName;
    }

    public McpToolException(string toolName, string serverName, string message, Exception innerException)
        : base(message, innerException)
    {
        ToolName = toolName;
        ServerName = serverName;
    }
}

/// <summary>
/// Exception thrown when the agent exceeds max steps.
/// </summary>
public class McpAgentMaxStepsException : McpUseException
{
    public int MaxSteps { get; }
    public int StepsTaken { get; }

    public McpAgentMaxStepsException(int maxSteps, int stepsTaken)
        : base($"Agent exceeded maximum steps ({maxSteps}). Steps taken: {stepsTaken}")
    {
        MaxSteps = maxSteps;
        StepsTaken = stepsTaken;
    }
}

/// <summary>
/// Base exception for security-related errors.
/// </summary>
public class McpSecurityException : McpUseException
{
    public McpSecurityException(string message) : base(message) { }
    public McpSecurityException(string message, Exception innerException) : base(message, innerException) { }
}

/// <summary>
/// Exception thrown when authentication fails (HTTP 401).
/// Return 401 Unauthorized: Missing or invalid token.
/// </summary>
public class McpAuthenticationException : McpSecurityException
{
    /// <summary>
    /// HTTP status code for this error (401).
    /// </summary>
    public int StatusCode => 401;

    public McpAuthenticationException(string message) : base(message) { }
    public McpAuthenticationException(string message, Exception innerException) : base(message, innerException) { }
}

/// <summary>
/// Exception thrown when authorization fails (HTTP 403).
/// Return 403 Forbidden: Valid token but insufficient permissions.
/// </summary>
public class McpAuthorizationException : McpSecurityException
{
    /// <summary>
    /// HTTP status code for this error (403).
    /// </summary>
    public int StatusCode => 403;

    public string? RequiredScope { get; }
    public string? Resource { get; }

    public McpAuthorizationException(string message) : base(message) { }

    public McpAuthorizationException(string message, string requiredScope, string resource)
        : base(message)
    {
        RequiredScope = requiredScope;
        Resource = resource;
    }

    public McpAuthorizationException(string message, Exception innerException) : base(message, innerException) { }
}

/// <summary>
/// Exception thrown for malformed requests (HTTP 400).
/// Return 400 Bad Request: Malformed authorization request.
/// </summary>
public class McpBadRequestException : McpUseException
{
    /// <summary>
    /// HTTP status code for this error (400).
    /// </summary>
    public int StatusCode => 400;

    public McpBadRequestException(string message) : base(message) { }
    public McpBadRequestException(string message, Exception innerException) : base(message, innerException) { }
}

/// <summary>
/// Exception thrown when rate limit is exceeded (HTTP 429).
/// </summary>
public class McpRateLimitException : McpSecurityException
{
    /// <summary>
    /// HTTP status code for this error (429).
    /// </summary>
    public int StatusCode => 429;

    /// <summary>
    /// Seconds until the rate limit resets.
    /// </summary>
    public int? RetryAfterSeconds { get; }

    public McpRateLimitException(string message, int? retryAfterSeconds = null)
        : base(message)
    {
        RetryAfterSeconds = retryAfterSeconds;
    }
}
