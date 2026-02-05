/// <summary>
/// Streaming Agent Example
/// 
/// Demonstrates real-time agent updates during execution.
/// </summary>

using McpUse;
using McpUse.Agent;
using McpUse.Client;
using Microsoft.Extensions.AI;
using OpenAI;

var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")
    ?? throw new InvalidOperationException("OPENAI_API_KEY environment variable not set");

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

var agent = new McpAgent(chatClient, mcpClient, new McpAgentOptions
{
    MaxSteps = 10,
    AutoInitialize = true
});

Console.WriteLine("🚀 Streaming MCP Agent ready! Type 'quit' to exit.\n");

while (true)
{
    Console.Write("You: ");
    var input = Console.ReadLine();

    if (string.IsNullOrWhiteSpace(input) || input.Equals("quit", StringComparison.OrdinalIgnoreCase))
        break;

    Console.WriteLine();

    try
    {
        await foreach (var update in agent.StreamAsync(input))
        {
            switch (update.Type)
            {
                case UpdateType.StepStart:
                    Console.ForegroundColor = ConsoleColor.DarkGray;
                    Console.WriteLine($"[Step {update.Step}]");
                    Console.ResetColor();
                    break;

                case UpdateType.Text:
                    Console.Write(update.Text);
                    break;

                case UpdateType.ToolCall:
                    Console.ForegroundColor = ConsoleColor.Cyan;
                    Console.WriteLine($"\n🔧 Calling tool: {update.ToolName}");
                    Console.ResetColor();
                    break;

                case UpdateType.ToolResult:
                    Console.ForegroundColor = ConsoleColor.Green;
                    var resultPreview = update.ToolResult?.Length > 100
                        ? update.ToolResult[..100] + "..."
                        : update.ToolResult;
                    Console.WriteLine($"✓ {update.ToolName}: {resultPreview}");
                    Console.ResetColor();
                    break;

                case UpdateType.ToolError:
                    Console.ForegroundColor = ConsoleColor.Red;
                    Console.WriteLine($"✗ {update.ToolName} failed: {update.Error}");
                    Console.ResetColor();
                    break;

                case UpdateType.Complete:
                    Console.ForegroundColor = ConsoleColor.DarkGray;
                    Console.WriteLine($"\n[{update.Message}]");
                    Console.ResetColor();
                    break;
            }
        }

        Console.WriteLine("\n");
    }
    catch (Exception ex)
    {
        Console.ForegroundColor = ConsoleColor.Red;
        Console.WriteLine($"\n❌ Error: {ex.Message}\n");
        Console.ResetColor();
    }
}

await agent.DisposeAsync();
Console.WriteLine("Goodbye!");
