/// <summary>
/// Multi-Server Example
/// 
/// Demonstrates how to:
/// - Configure multiple MCP servers
/// - Create and manage sessions for each server
/// - Use tools from different servers in a single agent
/// </summary>

using McpUse.Client;
using McpUse.Agent;
using Microsoft.Extensions.AI;
using OpenAI;

// Load API key from environment
var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")
    ?? throw new InvalidOperationException("OPENAI_API_KEY environment variable is required");

// Create a configuration with multiple C# MCP servers
var examplesPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
var serverExamplePath = Path.Combine(examplesPath, "ServerExample");
var fileSystemServerPath = Path.Combine(examplesPath, "FileSystemServer");

var config = new Dictionary<string, object>
{
    ["mcpServers"] = new Dictionary<string, object>
    {
        // C# server with calculator, weather, and notes tools
        ["tools"] = new Dictionary<string, object>
        {
            ["command"] = "dotnet",
            ["args"] = new[] { "run", "--project", serverExamplePath }
        },
        // C# file system server
        ["filesystem"] = new Dictionary<string, object>
        {
            ["command"] = "dotnet",
            ["args"] = new[] { "run", "--project", fileSystemServerPath, "--", Environment.CurrentDirectory }
        }
    }
};

// Create MCPClient with the multi-server configuration
var client = McpUseClient.FromDictionary(config);

// Create OpenAI chat client
var openAI = new OpenAIClient(apiKey);
IChatClient chatClient = openAI.GetChatClient("gpt-4o").AsIChatClient();

// Create agent with the client
var agent = new McpAgent(chatClient, client, new McpAgentOptions
{
    MaxSteps = 30
});

Console.WriteLine("Starting multi-server example...");
Console.WriteLine($"Available servers: {string.Join(", ", client.ServerNames)}");

try
{
    // Example: Using tools from different servers in a single query
    var result = await agent.RunAsync(
        "First, use the calculator to compute 42 * 17. " +
        "Then check the weather in Tokyo. " +
        "Finally, save these results to a file called 'results.txt' using the filesystem."
    );

    Console.WriteLine("\n=== Result ===");
    Console.WriteLine(result);
}
finally
{
    // Clean up
    await client.DisposeAsync();
}
