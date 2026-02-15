/// <summary>
/// OpenAI Integration Example
/// 
/// Demonstrates using OpenAI with MCP tools for AI agent tasks.
/// Uses the official OpenAI SDK with Microsoft.Extensions.AI integration.
/// </summary>

using McpUse.Client;
using McpUse.Agent;
using Microsoft.Extensions.AI;
using OpenAI;

// Load API key from environment
var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")
    ?? throw new InvalidOperationException("OPENAI_API_KEY environment variable is required");

// Configuration with C# MCP server
var serverProjectPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "ServerExample"));

var config = new Dictionary<string, object>
{
    ["mcpServers"] = new Dictionary<string, object>
    {
        ["tools"] = new Dictionary<string, object>
        {
            ["command"] = "dotnet",
            ["args"] = new[] { "run", "--project", serverProjectPath }
        }
    }
};

// Create MCPClient
var client = McpUseClient.FromDictionary(config);

// Create OpenAI chat client using Microsoft.Extensions.AI
var openAIClient = new OpenAIClient(apiKey);
IChatClient chatClient = openAIClient.GetChatClient("gpt-4o").AsIChatClient();

Console.WriteLine("OpenAI Integration Example");
Console.WriteLine("==========================");
Console.WriteLine($"Model: gpt-4o\n");

// Create agent
var agent = new McpAgent(chatClient, client, new McpAgentOptions
{
    MaxSteps = 30,
    AutoInitialize = true,
    SystemPrompt = "You are a helpful assistant with access to calculator, weather, and note-taking tools."
});

try
{
    var query = "Calculate 25 * 4, then get the weather in London.";
    Console.WriteLine($"Query: {query}\n");

    Console.WriteLine("Running agent...\n");

    // Use streaming for real-time output
    await foreach (var chunk in agent.StreamAsync(query))
    {
        Console.Write(chunk);
    }
    Console.WriteLine();
}
finally
{
    await client.DisposeAsync();
}
