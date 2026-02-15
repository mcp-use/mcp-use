/// <summary>
/// Interactive Chat Example
/// 
/// Demonstrates how to use McpAgent with built-in conversation memory
/// for contextual multi-turn interactions.
/// </summary>

using McpUse.Client;
using McpUse.Agent;
using Microsoft.Extensions.AI;
using OpenAI;

// Load API key from environment
var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")
    ?? throw new InvalidOperationException("OPENAI_API_KEY environment variable is required");

// Create configuration with C# MCP server
// Uses the ServerExample which provides calculator, weather, and note tools
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

// Create MCPClient from config
var client = McpUseClient.FromDictionary(config);

// Create OpenAI chat client
var openAI = new OpenAIClient(apiKey);
IChatClient chatClient = openAI.GetChatClient("gpt-4o").AsIChatClient();

// Create agent with memory enabled
var agent = new McpAgent(chatClient, client, new McpAgentOptions
{
    MaxSteps = 15,
    MemoryEnabled = true  // Enable built-in conversation memory
});

Console.WriteLine("\n===== Interactive MCP Chat =====");
Console.WriteLine("Type 'exit' or 'quit' to end the conversation");
Console.WriteLine("Type 'clear' to clear conversation history");
Console.WriteLine("==================================\n");

try
{
    // Main chat loop
    while (true)
    {
        // Get user input
        Console.Write("\nYou: ");
        var userInput = Console.ReadLine();

        // Check for exit command
        if (string.IsNullOrEmpty(userInput) ||
            userInput.Equals("exit", StringComparison.OrdinalIgnoreCase) ||
            userInput.Equals("quit", StringComparison.OrdinalIgnoreCase))
        {
            Console.WriteLine("Ending conversation...");
            break;
        }

        // Check for clear history command
        if (userInput.Equals("clear", StringComparison.OrdinalIgnoreCase))
        {
            agent.ClearConversationHistory();
            Console.WriteLine("Conversation history cleared.");
            continue;
        }

        // Get response from agent
        Console.Write("\nAssistant: ");

        try
        {
            // Run the agent with the user input (memory handling is automatic)
            var response = await agent.RunAsync(userInput);
            Console.WriteLine(response);
        }
        catch (Exception e)
        {
            Console.WriteLine($"\nError: {e.Message}");
        }
    }
}
finally
{
    // Clean up
    await client.DisposeAsync();
}
