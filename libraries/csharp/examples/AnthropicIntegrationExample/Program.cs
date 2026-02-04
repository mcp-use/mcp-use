/// <summary>
/// Anthropic Integration Example
/// 
/// Demonstrates using Anthropic Claude models with MCP tools.
/// Note: Requires Microsoft.Extensions.AI.Anthropic package when available,
/// or use Azure OpenAI Service with Claude models.
/// 
/// For now, this example shows the pattern using OpenAI as a reference.
/// Replace with Anthropic-specific client when SDK support is available.
/// </summary>

using McpUse.Client;
using McpUse.Agent;
using Microsoft.Extensions.AI;
using OpenAI;

// NOTE: This example currently uses OpenAI as a placeholder.
// When Microsoft.Extensions.AI.Anthropic is available, replace with:
//   var anthropic = new AnthropicClient(apiKey);
//   IChatClient chatClient = anthropic.GetChatClient("claude-sonnet-4-20250514").AsIChatClient();

// Load API key from environment
var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")
    ?? throw new InvalidOperationException("OPENAI_API_KEY environment variable is required. Set ANTHROPIC_API_KEY when Anthropic SDK is available.");

// Configuration with C# MCP server
var serverProjectPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "ServerExample"));

var config = new Dictionary<string, object>
{
    ["mcpServers"] = new Dictionary<string, object>
    {
        ["example-server"] = new Dictionary<string, object>
        {
            ["command"] = "dotnet",
            ["args"] = new[] { "run", "--project", serverProjectPath }
        }
    }
};

// Create MCPClient
var client = McpUseClient.FromDictionary(config);

// Create chat client (using OpenAI as placeholder)
var openAIClient = new OpenAIClient(apiKey);
IChatClient chatClient = openAIClient.GetChatClient("gpt-4o").AsIChatClient();

// Create agent
var agent = new McpAgent(chatClient, client, new McpAgentOptions
{
    MaxSteps = 30,
    AutoInitialize = true,
    SystemPrompt = "You are a helpful assistant with access to calculator and weather tools."
});

Console.WriteLine("Anthropic Integration Example (using OpenAI as placeholder)");
Console.WriteLine("============================================================\n");

try
{
    var query = "What is 42 * 17? Also, what's the weather like in Tokyo?";
    Console.WriteLine($"Query: {query}\n");

    Console.WriteLine("Running agent...\n");

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
