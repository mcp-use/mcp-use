using McpUse.Agent;
using McpUse.Client;
using McpUse.Configuration;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;

namespace McpUse.Extensions;

/// <summary>
/// Extension methods for registering mcp-use services with dependency injection.
/// </summary>
public static class ServiceCollectionExtensions
{
    /// <summary>
    /// Add McpUseClient with configuration from a file.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <param name="configFilePath">Path to the configuration file.</param>
    /// <returns>The service collection for chaining.</returns>
    public static IServiceCollection AddMcpUseClient(
        this IServiceCollection services,
        string configFilePath)
    {
        services.TryAddSingleton(sp =>
        {
            var loggerFactory = sp.GetService<ILoggerFactory>();
            return McpUseClient.FromConfigFile(configFilePath, loggerFactory);
        });

        return services;
    }

    /// <summary>
    /// Add McpUseClient with configuration.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <param name="configuration">The MCP configuration.</param>
    /// <returns>The service collection for chaining.</returns>
    public static IServiceCollection AddMcpUseClient(
        this IServiceCollection services,
        McpConfiguration configuration)
    {
        services.TryAddSingleton(sp =>
        {
            var loggerFactory = sp.GetService<ILoggerFactory>();
            return new McpUseClient(configuration, loggerFactory);
        });

        return services;
    }

    /// <summary>
    /// Add McpUseClient with a configuration factory.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <param name="configurationFactory">Factory to create the configuration.</param>
    /// <returns>The service collection for chaining.</returns>
    public static IServiceCollection AddMcpUseClient(
        this IServiceCollection services,
        Func<IServiceProvider, McpConfiguration> configurationFactory)
    {
        services.TryAddSingleton(sp =>
        {
            var config = configurationFactory(sp);
            var loggerFactory = sp.GetService<ILoggerFactory>();
            return new McpUseClient(config, loggerFactory);
        });

        return services;
    }

    /// <summary>
    /// Add McpAgent with the specified chat client.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <param name="options">Optional agent options.</param>
    /// <returns>The service collection for chaining.</returns>
    public static IServiceCollection AddMcpAgent(
        this IServiceCollection services,
        McpAgentOptions? options = null)
    {
        services.TryAddScoped(sp =>
        {
            var chatClient = sp.GetRequiredService<IChatClient>();
            var mcpClient = sp.GetRequiredService<McpUseClient>();
            var logger = sp.GetService<ILogger<McpAgent>>();
            return new McpAgent(chatClient, mcpClient, options, logger);
        });

        return services;
    }

    /// <summary>
    /// Add McpAgent with a factory for custom configuration.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <param name="agentFactory">Factory to create the agent.</param>
    /// <returns>The service collection for chaining.</returns>
    public static IServiceCollection AddMcpAgent(
        this IServiceCollection services,
        Func<IServiceProvider, McpAgent> agentFactory)
    {
        services.TryAddScoped(agentFactory);
        return services;
    }

    /// <summary>
    /// Add both McpUseClient and McpAgent with default configuration.
    /// </summary>
    /// <param name="services">The service collection.</param>
    /// <param name="configFilePath">Path to the configuration file.</param>
    /// <param name="agentOptions">Optional agent options.</param>
    /// <returns>The service collection for chaining.</returns>
    public static IServiceCollection AddMcpUse(
        this IServiceCollection services,
        string configFilePath,
        McpAgentOptions? agentOptions = null)
    {
        services.AddMcpUseClient(configFilePath);
        services.AddMcpAgent(agentOptions);
        return services;
    }
}
