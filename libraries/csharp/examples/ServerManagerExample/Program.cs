/// <summary>
/// Server Manager Example
/// 
/// Demonstrates using ServerManager to dynamically manage MCP servers
/// at runtime, including listing available servers.
/// </summary>

using McpUse.Client;
using McpUse.Agent;
using McpUse.Managers;
using Microsoft.Extensions.AI;
using OpenAI;

// Load API key from environment
var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")
    ?? throw new InvalidOperationException("OPENAI_API_KEY environment variable is required");

// Configuration with multiple C# MCP servers
var examplesPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
var serverExamplePath = Path.Combine(examplesPath, "ServerExample");
var fileSystemServerPath = Path.Combine(examplesPath, "FileSystemServer");

var config = new Dictionary<string, object>
{
    ["mcpServers"] = new Dictionary<string, object>
    {
        ["filesystem"] = new Dictionary<string, object>
        {
            ["command"] = "dotnet",
            ["args"] = new[] { "run", "--project", fileSystemServerPath, "--", Environment.CurrentDirectory }
        },
        ["tools"] = new Dictionary<string, object>
        {
            ["command"] = "dotnet",
            ["args"] = new[] { "run", "--project", serverExamplePath }
        }
    }
};

// Create MCPClient
var client = McpUseClient.FromDictionary(config);

// Create ServerManager for dynamic server management
var serverManager = new ServerManager(client);
await serverManager.InitializeAsync();

// Create OpenAI chat client
var openAI = new OpenAIClient(apiKey);
IChatClient chatClient = openAI.GetChatClient("gpt-4o").AsIChatClient();

// Create agent
var agent = new McpAgent(chatClient, client, new McpAgentOptions
{
    MaxSteps = 50,
    AutoInitialize = true
});

Console.WriteLine("Server Manager Example");
Console.WriteLine("======================\n");

// List configured servers
Console.WriteLine("Configured Servers:");
foreach (var serverName in serverManager.GetServerNames())
{
    Console.WriteLine($"  - {serverName}");
}
Console.WriteLine();

try
{
    // Let the agent use tools from different servers
    Console.WriteLine("=== Agent with Multi-Server Tools ===\n");

    var query = "List the files in the current directory, then calculate 100 * 5.";
    Console.WriteLine($"Query: {query}\n");

    var response = await agent.RunAsync(query);
    Console.WriteLine($"Response:\n{response}");
}
finally
{
    await client.DisposeAsync();
}
