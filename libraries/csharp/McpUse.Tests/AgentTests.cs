using Xunit;
using McpUse.Client;
using McpUse.Agent;
using Moq;
using Microsoft.Extensions.AI;

namespace McpUse.Tests;

/// <summary>
/// Tests for McpAgent
/// </summary>
public class AgentTests
{
    [Fact]
    public void Agent_InitWithClientAndChatClient_Succeeds()
    {
        // Arrange
        var mockChatClient = new Mock<IChatClient>();
        var mcpClient = McpUseClient.FromJson("""{ "mcpServers": {} }""");

        // Act
        var agent = new McpAgent(mockChatClient.Object, mcpClient);

        // Assert
        Assert.NotNull(agent);
        Assert.False(agent.IsInitialized);
    }

    [Fact]
    public void AgentOptions_DefaultValues_AreCorrect()
    {
        // Arrange & Act
        var options = new McpAgentOptions();

        // Assert
        Assert.Equal(5, options.MaxSteps);
        Assert.True(options.MemoryEnabled);
        Assert.False(options.AutoInitialize);
        Assert.NotNull(options.DisallowedTools);
        Assert.Empty(options.DisallowedTools);
    }

    [Fact]
    public void AgentOptions_CanCustomize_AllProperties()
    {
        // Arrange & Act
        var options = new McpAgentOptions
        {
            MaxSteps = 50,
            MemoryEnabled = true,
            AutoInitialize = false,
            SystemPrompt = "You are a helpful assistant",
            DisallowedTools = new List<string> { "tool1", "tool2" }
        };

        // Assert
        Assert.Equal(50, options.MaxSteps);
        Assert.True(options.MemoryEnabled);
        Assert.False(options.AutoInitialize);
        Assert.Equal("You are a helpful assistant", options.SystemPrompt);
        Assert.Equal(2, options.DisallowedTools.Count);
    }

    [Fact]
    public void Agent_RequiresChatClient()
    {
        // Arrange
        var mcpClient = McpUseClient.FromJson("""{ "mcpServers": {} }""");

        // Act & Assert
        Assert.Throws<ArgumentNullException>(() => new McpAgent(null!, mcpClient));
    }

    [Fact]
    public void Agent_RequiresClient()
    {
        // Arrange
        var mockChatClient = new Mock<IChatClient>();

        // Act & Assert
        Assert.Throws<ArgumentNullException>(() => new McpAgent(mockChatClient.Object, null!));
    }

    [Fact]
    public void Agent_WithOptionsIsNotInitialized()
    {
        // Arrange
        var mockChatClient = new Mock<IChatClient>();
        var mcpClient = McpUseClient.FromJson("""{ "mcpServers": {} }""");
        var options = new McpAgentOptions { AutoInitialize = false };

        // Act
        var agent = new McpAgent(mockChatClient.Object, mcpClient, options);

        // Assert
        Assert.False(agent.IsInitialized);
    }

    [Fact]
    public void AgentOptions_VerboseDisabledByDefault()
    {
        // Arrange & Act
        var options = new McpAgentOptions();

        // Assert
        Assert.False(options.Verbose);
    }

    [Fact]
    public void AgentOptions_DisallowedToolsEmptyByDefault()
    {
        // Arrange & Act
        var options = new McpAgentOptions();

        // Assert
        Assert.NotNull(options.DisallowedTools);
        Assert.Empty(options.DisallowedTools);
    }
}
