/// <summary>
/// Code Mode Example
/// 
/// Demonstrates how AI agents can use MCP tools through code execution,
/// enabling more efficient context usage and data processing.
/// 
/// See: https://www.anthropic.com/engineering/code-execution-with-mcp
/// </summary>

using McpUse.Client;
using McpUse.Agent;
using McpUse.CodeMode;
using Microsoft.Extensions.AI;
using OpenAI;

// Load API key from environment
var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")
    ?? throw new InvalidOperationException("OPENAI_API_KEY environment variable is required");

// Example configuration with C# file system MCP server
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

// Create MCPClient with code mode enabled
var client = McpUseClient.FromDictionary(config);

// Create code mode connector
var codeMode = new CodeModeConnector(client);
await codeMode.InitializeAsync();

// Create OpenAI chat client
var openAI = new OpenAIClient(apiKey);
IChatClient chatClient = openAI.GetChatClient("gpt-4o").AsIChatClient();

// Create agent with code mode instructions
var agent = new McpAgent(chatClient, client, new McpAgentOptions
{
    MaxSteps = 50,
    SystemPrompt = CodeModeConnector.CodeModeAgentPrompt
});

Console.WriteLine("Starting Code Mode Example...");
Console.WriteLine("Code mode allows the agent to execute C# code with MCP tool access.\n");

// Example query
var query = "Please list all the files in the current folder.";

try
{
    // Run with streaming to see progress
    await foreach (var chunk in agent.StreamAsync(query))
    {
        Console.Write(chunk);
    }
    Console.WriteLine();
}
finally
{
    await codeMode.DisposeAsync();
    await client.DisposeAsync();
}
