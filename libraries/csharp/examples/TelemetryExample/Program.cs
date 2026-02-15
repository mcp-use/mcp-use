/// <summary>
/// Telemetry Example - Observability and Monitoring
/// 
/// This example demonstrates using the TelemetryService for observability.
/// </summary>

using McpUse.Client;
using McpUse.Agent;
using McpUse.Telemetry;
using Microsoft.Extensions.AI;
using OpenAI;

// Load API keys from environment
var openAIKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")
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

// Create telemetry service with console sink for debugging
var telemetryOptions = new TelemetryOptions
{
    Enabled = true,
    CustomSink = new ConsoleTelemetrySink()
};
var telemetry = new TelemetryService(telemetryOptions);

Console.WriteLine("✓ Console telemetry enabled");
Console.WriteLine();

// Create OpenAI chat client
var openAI = new OpenAIClient(openAIKey);
IChatClient chatClient = openAI.GetChatClient("gpt-4o").AsIChatClient();

// Create agent
var agent = new McpAgent(chatClient, client, new McpAgentOptions
{
    MaxSteps = 30,
    AutoInitialize = true
});

Console.WriteLine("Telemetry Example");
Console.WriteLine("=================\n");

try
{
    var query = "Calculate 100 divided by 4, then get the weather in New York.";
    Console.WriteLine($"Query: {query}\n");

    Console.WriteLine("Running agent with telemetry...\n");

    var response = await agent.RunAsync(query);

    Console.WriteLine($"Response: {response}\n");
}
finally
{
    await telemetry.FlushAsync();
    await client.DisposeAsync();
}

/// <summary>
/// Simple console telemetry sink for local debugging
/// </summary>
public class ConsoleTelemetrySink : ITelemetrySink
{
    public Task RecordAsync(TelemetryEvent evt, CancellationToken cancellationToken = default)
    {
        Console.ForegroundColor = ConsoleColor.DarkCyan;
        Console.WriteLine($"[TELEMETRY] {evt.Name} (success={evt.Success}, {evt.DurationMs}ms)");
        Console.ResetColor();
        return Task.CompletedTask;
    }

    public Task FlushAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;
}
