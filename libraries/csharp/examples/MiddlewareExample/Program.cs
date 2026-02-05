/// <summary>
/// Middleware Example - Request/Response Processing Pipelines
/// 
/// This example demonstrates the middleware system for logging and filtering.
/// Note: Middleware is applied at the MCP protocol level, not at the agent level.
/// </summary>

using McpUse.Client;
using McpUse.Agent;
using McpUse.Middleware;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using OpenAI;

// Load API key from environment
var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")
    ?? throw new InvalidOperationException("OPENAI_API_KEY environment variable is required");

// Configuration with C# MCP server
var fileSystemServerPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "FileSystemServer"));

var config = new Dictionary<string, object>
{
    ["mcpServers"] = new Dictionary<string, object>
    {
        ["filesystem"] = new Dictionary<string, object>
        {
            ["command"] = "dotnet",
            ["args"] = new[] { "run", "--project", fileSystemServerPath, "--", Environment.CurrentDirectory }
        }
    }
};

// Create MCPClient
var client = McpUseClient.FromDictionary(config);

// Create OpenAI chat client
var openAI = new OpenAIClient(apiKey);
IChatClient chatClient = openAI.GetChatClient("gpt-4o").AsIChatClient();

// Create agent with tool restrictions using DisallowedTools
var agent = new McpAgent(chatClient, client, new McpAgentOptions
{
    MaxSteps = 30,
    AutoInitialize = true,
    DisallowedTools = new List<string> { "delete_file", "write_file" }  // Block dangerous operations
});

Console.WriteLine("Middleware Example");
Console.WriteLine("==================\n");

Console.WriteLine("Configuration:");
Console.WriteLine("  - Blocked tools: delete_file, write_file");
Console.WriteLine();

try
{
    // Query that uses allowed tools
    var query1 = "List the files in the current directory.";
    Console.WriteLine($"Query 1: {query1}\n");

    var response1 = await agent.RunAsync(query1);
    Console.WriteLine($"Response: {response1}\n");
}
finally
{
    await client.DisposeAsync();
}
