using Xunit;

namespace McpUse.Tests;

/// <summary>
/// Tests for Exception types
/// </summary>
public class ExceptionTests
{
    [Fact]
    public void McpUseException_HasMessage()
    {
        // Act
        var ex = new McpUseException("Test message");

        // Assert
        Assert.Equal("Test message", ex.Message);
    }

    [Fact]
    public void McpUseException_HasInnerException()
    {
        // Arrange
        var inner = new InvalidOperationException("inner");

        // Act
        var ex = new McpUseException("Test message", inner);

        // Assert
        Assert.Equal("Test message", ex.Message);
        Assert.Same(inner, ex.InnerException);
    }

    [Fact]
    public void McpConnectionException_HasServerName()
    {
        // Act
        var ex = new McpConnectionException("my-server", "Connection failed");

        // Assert
        Assert.Equal("my-server", ex.ServerName);
        Assert.Equal("Connection failed", ex.Message);
    }

    [Fact]
    public void McpToolException_HasToolAndServerName()
    {
        // Act
        var ex = new McpToolException("read_file", "filesystem", "Tool failed");

        // Assert
        Assert.Equal("read_file", ex.ToolName);
        Assert.Equal("filesystem", ex.ServerName);
        Assert.Equal("Tool failed", ex.Message);
    }

    [Fact]
    public void McpAgentMaxStepsException_HasStepInfo()
    {
        // Act
        var ex = new McpAgentMaxStepsException(10, 12);

        // Assert
        Assert.Equal(10, ex.MaxSteps);
        Assert.Equal(12, ex.StepsTaken);
        Assert.Contains("10", ex.Message);
        Assert.Contains("12", ex.Message);
    }

    [Fact]
    public void McpConfigurationException_IsDerivedException()
    {
        // Act
        var ex = new McpConfigurationException("Invalid config");

        // Assert
        Assert.IsAssignableFrom<McpUseException>(ex);
        Assert.Equal("Invalid config", ex.Message);
    }

    [Fact]
    public void McpSecurityException_IsDerivedException()
    {
        // Act
        var ex = new McpSecurityException("Access denied");

        // Assert
        Assert.IsAssignableFrom<McpUseException>(ex);
        Assert.Equal("Access denied", ex.Message);
    }
}
