/// <summary>
/// Structured Output Example
/// 
/// Demonstrates how to get strongly-typed responses from the agent
/// using C# records and System.Text.Json deserialization.
/// </summary>

using System.Text.Json;
using System.Text.Json.Serialization;
using McpUse.Client;
using McpUse.Agent;
using Microsoft.Extensions.AI;
using OpenAI;

// Load API key from environment
var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")
    ?? throw new InvalidOperationException("OPENAI_API_KEY environment variable is required");

// Define structured output schema
var cityInfoSchema = """
{
    "type": "object",
    "properties": {
        "city": { "type": "string", "description": "Name of the city" },
        "country": { "type": "string", "description": "Country the city is in" },
        "population": { "type": "integer", "description": "Estimated population" },
        "famous_for": { 
            "type": "array", 
            "items": { "type": "string" },
            "description": "Things the city is famous for" 
        },
        "best_time_to_visit": { "type": "string", "description": "Best season or months to visit" },
        "local_currency": { "type": "string", "description": "The local currency used" }
    },
    "required": ["city", "country", "population", "famous_for", "best_time_to_visit", "local_currency"]
}
""";

// Configuration with C# MCP server (provides weather data for cities)
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

// Create OpenAI chat client
var openAI = new OpenAIClient(apiKey);
IChatClient chatClient = openAI.GetChatClient("gpt-4o").AsIChatClient();

// Create agent with structured output system prompt
var agent = new McpAgent(chatClient, client, new McpAgentOptions
{
    MaxSteps = 30,
    SystemPrompt = $"""
        You are a helpful travel assistant. When asked about cities,
        use the get_weather tool to get current conditions, then return information
        in the following JSON format:
        
        {cityInfoSchema}
        
        For population and other facts, use your knowledge. Always respond with valid JSON matching this schema.
        """,
    AutoInitialize = true
});

Console.WriteLine("Structured Output Example");
Console.WriteLine("=========================\n");

var city = "Tokyo";
var query = $"Research {city} and provide detailed information about it. Return the result as JSON.";

try
{
    Console.WriteLine($"Researching {city}...\n");

    var response = await agent.RunAsync(query);

    Console.WriteLine("Raw response:");
    Console.WriteLine(response);
    Console.WriteLine();

    // Extract JSON from response (handle markdown code blocks)
    var json = ExtractJson(response);

    if (!string.IsNullOrEmpty(json))
    {
        var cityInfo = JsonSerializer.Deserialize<CityInfo>(json);

        if (cityInfo != null)
        {
            Console.WriteLine("Parsed CityInfo:");
            Console.WriteLine($"  City: {cityInfo.City}");
            Console.WriteLine($"  Country: {cityInfo.Country}");
            Console.WriteLine($"  Population: {cityInfo.Population:N0}");
            Console.WriteLine($"  Famous for: {string.Join(", ", cityInfo.FamousFor)}");
            Console.WriteLine($"  Best time to visit: {cityInfo.BestTimeToVisit}");
            Console.WriteLine($"  Local currency: {cityInfo.LocalCurrency}");
        }
    }
    else
    {
        Console.WriteLine("Could not extract JSON from response.");
    }
}
finally
{
    await client.DisposeAsync();
}

// Helper function to extract JSON from response (handles markdown code blocks)
static string ExtractJson(string response)
{
    // Try to find JSON in markdown code block
    var jsonStart = response.IndexOf("```json");
    if (jsonStart >= 0)
    {
        jsonStart = response.IndexOf('\n', jsonStart) + 1;
        var jsonEnd = response.IndexOf("```", jsonStart);
        if (jsonEnd > jsonStart)
        {
            return response[jsonStart..jsonEnd].Trim();
        }
    }

    // Try to find raw JSON object
    var braceStart = response.IndexOf('{');
    if (braceStart >= 0)
    {
        var braceEnd = response.LastIndexOf('}');
        if (braceEnd > braceStart)
        {
            return response[braceStart..(braceEnd + 1)];
        }
    }

    return response;
}

// C# record for strongly-typed deserialization (must be at end with top-level statements)
record CityInfo(
    [property: JsonPropertyName("city")] string City,
    [property: JsonPropertyName("country")] string Country,
    [property: JsonPropertyName("population")] int Population,
    [property: JsonPropertyName("famous_for")] string[] FamousFor,
    [property: JsonPropertyName("best_time_to_visit")] string BestTimeToVisit,
    [property: JsonPropertyName("local_currency")] string LocalCurrency
);
