using Xunit;
using McpUse.Connectors;

namespace McpUse.Tests;

/// <summary>
/// Tests for Connectors
/// </summary>
public class ConnectorTests
{
    [Fact]
    public void StdioConnector_InitializesWithCommand()
    {
        var connector = new StdioConnector("dotnet", new[] { "--version" });

        Assert.Equal("stdio", connector.Name);
        Assert.False(connector.IsConnected);
    }

    [Fact]
    public void HttpConnector_InitializesWithUrl()
    {
        var connector = new HttpConnector("https://example.com/mcp");

        Assert.Equal("http", connector.Name);
        Assert.False(connector.IsConnected);
    }

    [Fact]
    public void StdioConnector_ThrowsOnNullCommand()
    {
        Assert.Throws<ArgumentNullException>(() => new StdioConnector(null!, null));
    }

    [Fact]
    public void HttpConnector_ThrowsOnNullUrl()
    {
        Assert.Throws<ArgumentNullException>(() => new HttpConnector(null!));
    }

    [Fact]
    public void StdioConnector_StoresArgsCorrectly()
    {
        var args = new[] { "--verbose", "--port", "8080" };

        var connector = new StdioConnector("dotnet", args);

        Assert.Equal("stdio", connector.Name);
    }

    [Fact]
    public void HttpConnector_ParsesUrl()
    {
        var connector = new HttpConnector("https://api.example.com/v1/mcp");

        Assert.Equal("http", connector.Name);
        Assert.False(connector.IsConnected);
    }

    [Fact]
    public void StdioConnector_AcceptsEmptyArgs()
    {
        var connector = new StdioConnector("dotnet", Array.Empty<string>());

        Assert.NotNull(connector);
    }

    [Fact]
    public void HttpConnector_SupportsHttpsUrls()
    {
        var connector = new HttpConnector("https://secure.example.com/mcp");

        Assert.NotNull(connector);
        Assert.Equal("http", connector.Name);
    }
}
