using Xunit;
using McpUse.Client;
using McpUse.Configuration;

namespace McpUse.Tests;

/// <summary>
/// Tests for McpSession
/// </summary>
public class SessionTests
{
    [Fact]
    public void McpSession_InitializesCorrectly()
    {
        // Arrange
        var config = new McpServerConfig { Command = "dotnet" };

        // Act
        var session = new McpUseSession("test", config);

        // Assert
        Assert.Equal("test", session.Name);
        Assert.False(session.IsConnected);
    }

    [Fact]
    public void McpSession_RequiresName()
    {
        // Arrange
        var config = new McpServerConfig { Command = "dotnet" };

        // Act & Assert
        Assert.Throws<ArgumentNullException>(() => new McpUseSession(null!, config));
    }

    [Fact]
    public void McpSession_RequiresConfig()
    {
        // Act & Assert
        Assert.Throws<ArgumentNullException>(() => new McpUseSession("test", null!));
    }

    [Fact]
    public void McpSession_NotConnectedByDefault()
    {
        // Arrange
        var config = new McpServerConfig { Command = "dotnet" };
        var session = new McpUseSession("test", config);

        // Assert
        Assert.False(session.IsConnected);
        Assert.Null(session.ServerInfo);
        Assert.Null(session.Capabilities);
    }
}
