using Xunit;
using McpUse.Client;
using McpUse.CodeMode;

namespace McpUse.Tests;

/// <summary>
/// Tests for CodeExecutor
/// </summary>
public class CodeExecutorTests
{
    [Fact]
    public void CodeExecutor_CanBeCreated()
    {
        // Arrange
        var client = McpUseClient.FromJson("""{ "mcpServers": {} }""");

        // Act
        var executor = new CodeExecutor(client);

        // Assert
        Assert.NotNull(executor);
    }

    [Fact]
    public void CodeExecutor_AcceptsNullClientGracefully()
    {
        // Note: Currently CodeExecutor allows null client (deferred validation)
        var executor = new CodeExecutor(null!);
        Assert.NotNull(executor);
    }

    [Fact]
    public void CodeExecutorOptions_HasCorrectDefaults()
    {
        // Act
        var options = new CodeExecutorOptions();

        // Assert
        Assert.True(options.Timeout > TimeSpan.Zero);
    }

    [Fact]
    public void CodeExecutorOptions_CanCustomizeTimeout()
    {
        // Act
        var options = new CodeExecutorOptions
        {
            Timeout = TimeSpan.FromSeconds(60)
        };

        // Assert
        Assert.Equal(TimeSpan.FromSeconds(60), options.Timeout);
    }

    [Fact]
    public void CodeExecutionResult_SuccessHasResult()
    {
        // Arrange & Act
        var result = new CodeExecutionResult
        {
            Success = true,
            Result = 42
        };

        // Assert
        Assert.True(result.Success);
        Assert.Equal(42, result.Result);
        Assert.Null(result.Error);
    }

    [Fact]
    public void CodeExecutionResult_FailureHasError()
    {
        // Arrange & Act
        var result = new CodeExecutionResult
        {
            Success = false,
            Error = "Compilation error"
        };

        // Assert
        Assert.False(result.Success);
        Assert.Equal("Compilation error", result.Error);
    }
}
