using Xunit;
using McpUse.Configuration;

namespace McpUse.Tests;

/// <summary>
/// Tests for Configuration loading
/// </summary>
public class ConfigurationTests
{
    [Fact]
    public void ConfigLoader_ParsesClaudeDesktopFormat()
    {
        var json = """
        {
            "mcpServers": {
                "filesystem": {
                    "command": "dotnet",
                    "args": ["run", "--project", "FileServer"]
                },
                "github": {
                    "command": "dotnet",
                    "args": ["run", "--project", "GitHubServer"],
                    "env": {
                        "GITHUB_TOKEN": "test-token"
                    }
                }
            }
        }
        """;

        var config = ConfigLoader.FromJson(json);

        Assert.NotNull(config);
        Assert.Equal(2, config.McpServers.Count);
        Assert.True(config.McpServers.ContainsKey("filesystem"));
        Assert.True(config.McpServers.ContainsKey("github"));

        var fsConfig = config.McpServers["filesystem"];
        Assert.Equal("dotnet", fsConfig.Command);
        Assert.Equal(3, fsConfig.Args?.Count);

        var ghConfig = config.McpServers["github"];
        Assert.NotNull(ghConfig.Env);
        Assert.Equal("test-token", ghConfig.Env["GITHUB_TOKEN"]);
    }

    [Fact]
    public void ConfigLoader_ParsesHttpServerConfig()
    {
        var json = """
        {
            "mcpServers": {
                "http-server": {
                    "url": "http://localhost:3000/mcp"
                }
            }
        }
        """;

        var config = ConfigLoader.FromJson(json);

        Assert.NotNull(config);
        Assert.Single(config.McpServers);

        var serverConfig = config.McpServers["http-server"];
        Assert.Null(serverConfig.Command);
        Assert.Equal("http://localhost:3000/mcp", serverConfig.Url);
        Assert.True(serverConfig.IsHttp);
    }

    [Fact]
    public void ConfigLoader_ThrowsForInvalidJson()
    {
        var json = "{ invalid json }";

        Assert.ThrowsAny<Exception>(() => ConfigLoader.FromJson(json));
    }

    [Fact]
    public void ConfigLoader_CreatesHttpConnector()
    {
        var serverConfig = new McpServerConfig
        {
            Url = "http://test.com"
        };

        Assert.True(serverConfig.IsHttp);
        Assert.False(serverConfig.IsStdio);
    }

    [Fact]
    public void ConfigLoader_StdioVsHttpMutuallyExclusive()
    {
        var stdioConfig = new McpServerConfig { Command = "dotnet" };
        var httpConfig = new McpServerConfig { Url = "http://test.com" };

        Assert.True(stdioConfig.IsStdio);
        Assert.False(stdioConfig.IsHttp);
        Assert.False(httpConfig.IsStdio);
        Assert.True(httpConfig.IsHttp);
    }

    [Fact]
    public void ConfigLoader_ParsesHeaders()
    {
        var json = """
        {
            "mcpServers": {
                "api-server": {
                    "url": "http://localhost:3000/mcp",
                    "headers": {
                        "Content-Type": "application/json",
                        "X-Custom-Header": "value"
                    }
                }
            }
        }
        """;

        var config = ConfigLoader.FromJson(json);

        var serverConfig = config.McpServers["api-server"];
        Assert.NotNull(serverConfig.Headers);
        Assert.Equal(2, serverConfig.Headers.Count);
        Assert.Equal("application/json", serverConfig.Headers["Content-Type"]);
        Assert.Equal("value", serverConfig.Headers["X-Custom-Header"]);
    }

    [Fact]
    public void ConfigLoader_ParsesEnvVariables()
    {
        var json = """
        {
            "mcpServers": {
                "env-server": {
                    "command": "dotnet",
                    "env": {
                        "API_KEY": "secret",
                        "DEBUG": "true"
                    }
                }
            }
        }
        """;

        var config = ConfigLoader.FromJson(json);

        var serverConfig = config.McpServers["env-server"];
        Assert.NotNull(serverConfig.Env);
        Assert.Equal(2, serverConfig.Env.Count);
        Assert.Equal("secret", serverConfig.Env["API_KEY"]);
    }
}

/// <summary>
/// Tests for McpServerConfig model
/// </summary>
public class McpServerConfigTests
{
    [Fact]
    public void DetectsStdioMode()
    {
        var config = new McpServerConfig
        {
            Command = "dotnet",
            Args = ["run", "--project", "MyServer"]
        };

        Assert.True(config.IsStdio);
        Assert.False(config.IsHttp);
    }

    [Fact]
    public void DetectsHttpMode()
    {
        var config = new McpServerConfig
        {
            Url = "http://localhost:3000/mcp"
        };

        Assert.False(config.IsStdio);
        Assert.True(config.IsHttp);
    }

    [Fact]
    public void EnabledByDefault()
    {
        var config = new McpServerConfig();
        Assert.True(config.Enabled);
    }
}
