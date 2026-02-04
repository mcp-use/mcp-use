/// <summary>
/// Basic MCP Agent Example
/// 
/// Demonstrates how to create an MCP agent with tool access.
/// </summary>

using McpUse;
using McpUse.Agent;
using McpUse.Client;
using Microsoft.Extensions.AI;
using OpenAI;

// Load API key from environment
var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")
    ?? throw new InvalidOperationException("OPENAI_API_KEY environment variable not set");

// Create the chat client (using OpenAI)
var openAIClient = new OpenAIClient(apiKey);
IChatClient chatClient = openAIClient.GetChatClient("gpt-4o").AsIChatClient();

// Configure MCP server (uses FileSystemServer example)
var serverPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "FileSystemServer"));
var mcpClient = McpUseClient.FromDictionary(new Dictionary<string, object>
{
    ["mcpServers"] = new Dictionary<string, object>
    {
        ["filesystem"] = new Dictionary<string, object>
        {
            ["command"] = "dotnet",
            ["args"] = new[] { "run", "--project", serverPath, "." }
        }
    }
});

// Create the agent
var agent = new McpAgent(chatClient, mcpClient, new McpAgentOptions
{
    MaxSteps = 10,
    AutoInitialize = true,  // Automatically connect to servers on first run
    MemoryEnabled = true    // Remember conversation history
});

Console.WriteLine("🚀 MCP Agent ready! Type 'quit' to exit.\n");

// Interactive chat loop
while (true)
{
    Console.Write("You: ");
    var input = Console.ReadLine();

    if (string.IsNullOrWhiteSpace(input) || input.Equals("quit", StringComparison.OrdinalIgnoreCase))
        break;

    try
    {
        Console.Write("\nAgent: ");
        var result = await agent.RunAsync(input);
        Console.WriteLine(result);
        Console.WriteLine();
    }
    catch (Exception ex)
    {
        Console.WriteLine($"\n❌ Error: {ex.Message}\n");
    }
}

// Cleanup
await agent.DisposeAsync();
Console.WriteLine("Goodbye!");
