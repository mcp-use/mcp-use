/// <summary>
/// Streaming Example
/// 
/// Demonstrates how to use streaming to observe agent execution in real-time,
/// seeing output as it happens.
/// </summary>

using McpUse.Client;
using McpUse.Agent;
using Microsoft.Extensions.AI;
using OpenAI;

// Load API key from environment
var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")
    ?? throw new InvalidOperationException("OPENAI_API_KEY environment variable is required");

// Configuration using C# MCP server
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

// Create MCPClient from config dictionary
var client = McpUseClient.FromDictionary(config);

// Create OpenAI chat client
var openAI = new OpenAIClient(apiKey);
IChatClient chatClient = openAI.GetChatClient("gpt-4o").AsIChatClient();

// Create agent with streaming enabled
var agent = new McpAgent(chatClient, client, new McpAgentOptions
{
    MaxSteps = 30,
    AutoInitialize = true
});

Console.WriteLine("Starting Streaming Example...");
Console.WriteLine("This example demonstrates real-time streaming of agent execution.\n");
Console.WriteLine("Watching the agent use tools...\n");

var query = "Calculate 123 * 456 and then get the weather in Paris.";

try
{
    // Text streaming
    Console.WriteLine("=== Streaming Output ===\n");
    await foreach (var text in agent.StreamAsync(query))
    {
        Console.Write(text);
    }
    Console.WriteLine("\n");

    // Second query
    var query2 = "Now save a note titled 'Calculation' with the result of that calculation.";

    Console.WriteLine("=== Second Query ===\n");
    Console.WriteLine($"Query: {query2}\n");

    await foreach (var text in agent.StreamAsync(query2))
    {
        Console.Write(text);
    }
    Console.WriteLine();
}
finally
{
    await client.DisposeAsync();
}
