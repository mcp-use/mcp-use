using Xunit;
using McpUse.Connectors;
using McpUse.Middleware;

namespace McpUse.Tests;

/// <summary>
/// Tests for JsonRpc types
/// </summary>
public class JsonRpcTests
{
    [Fact]
    public void JsonRpcRequest_HasCorrectDefaults()
    {
        var request = new JsonRpcRequest { Method = "test" };

        Assert.Equal("2.0", request.JsonRpc);
        Assert.Equal("test", request.Method);
        Assert.NotEmpty(request.Id);
    }

    [Fact]
    public void JsonRpcResponse_IsSuccess_WhenNoError()
    {
        var response = new JsonRpcResponse { Result = "ok" };

        Assert.True(response.IsSuccess);
    }

    [Fact]
    public void JsonRpcResponse_IsNotSuccess_WhenError()
    {
        var response = new JsonRpcResponse
        {
            Error = new JsonRpcError { Code = -32600, Message = "Invalid Request" }
        };

        Assert.False(response.IsSuccess);
    }
}

/// <summary>
/// Tests for Middleware
/// </summary>
public class MiddlewareTests
{
    [Fact]
    public void LoggingMiddleware_CanBeCreated()
    {
        // Act
        var middleware = new LoggingMiddleware();

        // Assert
        Assert.NotNull(middleware);
    }
}

/// <summary>
/// Tests for McpServer
/// </summary>
public class McpServerTests
{
    [Fact]
    public void McpServerOptions_HasCorrectDefaults()
    {
        // Act
        var options = new McpUse.Server.McpServerOptions
        {
            Name = "test-server"
        };

        // Assert
        Assert.Equal("test-server", options.Name);
        Assert.Equal("1.0.0", options.Version);
        Assert.Equal("stdio", options.Transport);
        Assert.Equal(8080, options.Port);
        Assert.Equal("/mcp", options.BasePath);
    }

    [Fact]
    public void McpServer_CanBeCreated()
    {
        // Arrange
        var options = new McpUse.Server.McpServerOptions
        {
            Name = "test-server"
        };

        // Act
        var server = new McpUse.Server.McpServer(options);

        // Assert
        Assert.NotNull(server);
    }
}
