using Xunit;
using McpUse.Client;
using McpUse.Configuration;

namespace McpUse.Tests;

/// <summary>
/// Tests for McpUseClient
/// </summary>
public class McpUseClientTests
{
    [Fact]
    public void FromJson_ParsesConfig()
    {
        // Arrange
        var json = """
        {
            "mcpServers": {
                "filesystem": {
                    "command": "dotnet",
                    "args": ["run", "--project", "MyMcpServer"]
                }
            }
        }
        """;

        // Act
        var client = McpUseClient.FromJson(json);

        // Assert
        Assert.NotNull(client);
        Assert.Single(client.ServerNames);
        Assert.Contains("filesystem", client.ServerNames);
    }

    [Fact]
    public void FromDictionary_ParsesServers()
    {
        // Arrange
        var config = new Dictionary<string, object>
        {
            ["mcpServers"] = new Dictionary<string, object>
            {
                ["test"] = new Dictionary<string, object>
                {
                    ["url"] = "http://test.com"
                }
            }
        };

        // Act
        var client = McpUseClient.FromDictionary(config);

        // Assert
        Assert.NotNull(client);
        Assert.Single(client.ServerNames);
        Assert.Contains("test", client.ServerNames);
    }

    [Fact]
    public void GetSession_ReturnsNullForUnknown()
    {
        // Arrange
        var json = """{ "mcpServers": {} }""";
        var client = McpUseClient.FromJson(json);

        // Act
        var session = client.GetSession("nonexistent");

        // Assert
        Assert.Null(session);
    }

    [Fact]
    public void ServerNames_ReturnsAllServers()
    {
        // Arrange
        var json = """
        {
            "mcpServers": {
                "server1": { "command": "cmd1" },
                "server2": { "command": "cmd2" },
                "server3": { "command": "cmd3" }
            }
        }
        """;
        var client = McpUseClient.FromJson(json);

        // Act
        var names = client.ServerNames;

        // Assert
        Assert.Equal(3, names.Count);
        Assert.Contains("server1", names);
        Assert.Contains("server2", names);
        Assert.Contains("server3", names);
    }

    [Fact]
    public void Init_Empty_CreatesEmptyClient()
    {
        // Arrange & Act
        var client = McpUseClient.FromJson("""{ "mcpServers": {} }""");

        // Assert
        Assert.Empty(client.ServerNames);
        Assert.Empty(client.ActiveSessions);
    }

    [Fact]
    public void AddServer_AddsToConfiguration()
    {
        // Arrange
        var client = McpUseClient.FromJson("""{ "mcpServers": {} }""");
        var serverConfig = new McpServerConfig { Url = "http://test.com" };

        // Act
        client.AddServer("test", serverConfig);

        // Assert
        Assert.Single(client.ServerNames);
        Assert.Contains("test", client.ServerNames);
    }

    [Fact]
    public void AddServer_ToExistingServers()
    {
        // Arrange
        var client = McpUseClient.FromJson("""
        {
            "mcpServers": {
                "server1": { "url": "http://server1.com" }
            }
        }
        """);
        var serverConfig = new McpServerConfig { Url = "http://test.com" };

        // Act
        client.AddServer("test", serverConfig);

        // Assert
        Assert.Equal(2, client.ServerNames.Count);
        Assert.Contains("server1", client.ServerNames);
        Assert.Contains("test", client.ServerNames);
    }

    [Fact]
    public void ServerNames_ExcludesDisabledServers()
    {
        // Arrange
        var json = """
        {
            "mcpServers": {
                "enabled1": { "command": "cmd1", "enabled": true },
                "disabled1": { "command": "cmd2", "enabled": false },
                "enabled2": { "command": "cmd3" }
            }
        }
        """;
        var client = McpUseClient.FromJson(json);

        // Act
        var names = client.ServerNames;

        // Assert
        Assert.Equal(2, names.Count);
        Assert.Contains("enabled1", names);
        Assert.Contains("enabled2", names);
        Assert.DoesNotContain("disabled1", names);
    }

    [Fact]
    public void GetAllActiveSessions_ReturnsEmptyBeforeConnection()
    {
        // Arrange
        var client = McpUseClient.FromJson("""
        {
            "mcpServers": {
                "server1": { "command": "cmd1" }
            }
        }
        """);

        // Act
        var sessions = client.GetAllActiveSessions();

        // Assert
        Assert.Empty(sessions);
    }
}
