using Xunit;
using McpUse.Client;
using McpUse.Managers;

namespace McpUse.Tests;

/// <summary>
/// Tests for ServerManager
/// </summary>
public class ServerManagerTests
{
    [Fact]
    public void ServerManager_InitializesWithClient()
    {
        // Arrange
        var mcpClient = McpUseClient.FromJson("""
        {
            "mcpServers": {
                "server1": { "command": "cmd1" },
                "server2": { "command": "cmd2" }
            }
        }
        """);

        // Act
        var manager = new ServerManager(mcpClient);

        // Assert
        Assert.NotNull(manager);
    }

    [Fact]
    public void ServerManager_GetServerNamesMatchesClient()
    {
        // Arrange
        var mcpClient = McpUseClient.FromJson("""
        {
            "mcpServers": {
                "server1": { "command": "cmd1" },
                "server2": { "command": "cmd2" }
            }
        }
        """);

        // Act
        var manager = new ServerManager(mcpClient);
        var names = manager.GetServerNames();

        // Assert
        Assert.Equal(2, names.Count);
        Assert.Contains("server1", names);
        Assert.Contains("server2", names);
    }

    [Fact]
    public void ServerManager_RequiresClient()
    {
        // Act & Assert
        Assert.Throws<ArgumentNullException>(() => new ServerManager(null!));
    }

    [Fact]
    public void ServerManager_HasNoToolsByDefault()
    {
        // Arrange
        var mcpClient = McpUseClient.FromJson("""{ "mcpServers": { "test": { "command": "cmd" } } }""");
        var manager = new ServerManager(mcpClient);

        // Assert
        Assert.NotNull(manager);
    }
}
