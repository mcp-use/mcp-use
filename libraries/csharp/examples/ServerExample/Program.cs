/// <summary>
/// MCP Server Example
/// 
/// Demonstrates how to create an MCP server that exposes custom tools
/// to AI agents.
/// </summary>

using System.Text.Json;
using McpUse.Server;

// Create server options
var options = new McpServerOptions
{
    Name = "example-server",
    Version = "1.0.0",
    Transport = "stdio"
};

// Create an MCP server with custom tools
var server = new McpServer(options);

// Storage for notes
var notes = new Dictionary<string, string>();

// Register a simple calculator tool
server.AddTool(new ToolDefinition
{
    Name = "calculator",
    Description = "Performs basic arithmetic operations",
    InputSchema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "operation": { "type": "string", "enum": ["add", "subtract", "multiply", "divide"] },
            "a": { "type": "number", "description": "First operand" },
            "b": { "type": "number", "description": "Second operand" }
        },
        "required": ["operation", "a", "b"]
    }
    """).RootElement,
    Handler = async (arguments, cancellationToken) =>
    {
        var op = arguments["operation"]?.ToString();
        var a = Convert.ToDouble(arguments["a"]);
        var b = Convert.ToDouble(arguments["b"]);

        var result = op switch
        {
            "add" => a + b,
            "subtract" => a - b,
            "multiply" => a * b,
            "divide" => b != 0 ? a / b : double.NaN,
            _ => throw new ArgumentException($"Unknown operation: {op}")
        };

        return new { result, operation = op, a, b };
    }
});

// Register a weather lookup tool (simulated)
server.AddTool(new ToolDefinition
{
    Name = "get_weather",
    Description = "Gets the current weather for a city",
    InputSchema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "city": { "type": "string", "description": "City name" },
            "units": { "type": "string", "enum": ["celsius", "fahrenheit"], "default": "celsius" }
        },
        "required": ["city"]
    }
    """).RootElement,
    Handler = async (arguments, cancellationToken) =>
    {
        var city = arguments["city"]?.ToString() ?? "Unknown";
        var units = arguments.TryGetValue("units", out var unitsVal)
            ? unitsVal?.ToString() ?? "celsius"
            : "celsius";

        // Simulated weather data
        var random = new Random();
        var temp = random.Next(units == "celsius" ? 15 : 59, units == "celsius" ? 30 : 86);
        var conditions = new[] { "sunny", "cloudy", "partly cloudy", "rainy" };
        var condition = conditions[random.Next(conditions.Length)];

        return new
        {
            city,
            temperature = temp,
            units,
            condition,
            humidity = random.Next(40, 80),
            timestamp = DateTime.UtcNow
        };
    }
});

// Register a note-taking resource
server.AddResource(new ResourceDefinition
{
    Uri = "notes://list",
    Name = "Notes List",
    Description = "List of all saved notes",
    MimeType = "application/json",
    Handler = async (cancellationToken) =>
    {
        return JsonSerializer.Serialize(notes);
    }
});

// Register note tools
server.AddTool(new ToolDefinition
{
    Name = "save_note",
    Description = "Saves a note with a title",
    InputSchema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "title": { "type": "string", "description": "Note title" },
            "content": { "type": "string", "description": "Note content" }
        },
        "required": ["title", "content"]
    }
    """).RootElement,
    Handler = async (arguments, cancellationToken) =>
    {
        var title = arguments["title"]?.ToString() ?? "";
        var content = arguments["content"]?.ToString() ?? "";

        notes[title] = content;

        return new { success = true, title, message = "Note saved successfully" };
    }
});

server.AddTool(new ToolDefinition
{
    Name = "get_note",
    Description = "Retrieves a note by title",
    InputSchema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "title": { "type": "string", "description": "Note title" }
        },
        "required": ["title"]
    }
    """).RootElement,
    Handler = async (arguments, cancellationToken) =>
    {
        var title = arguments["title"]?.ToString() ?? "";

        if (notes.TryGetValue(title, out var content))
        {
            return new { found = true, title, content };
        }

        return new { found = false, title, error = "Note not found" };
    }
});

Console.Error.WriteLine("MCP Server Example");
Console.Error.WriteLine("==================");
Console.Error.WriteLine($"Server: {options.Name} v{options.Version}");
Console.Error.WriteLine("Starting server... (press Ctrl+C to stop)");
Console.Error.WriteLine();
Console.Error.WriteLine("This server can be used by MCP clients like:");
Console.Error.WriteLine(@"  {");
Console.Error.WriteLine(@"    ""mcpServers"": {");
Console.Error.WriteLine(@"      ""example"": {");
Console.Error.WriteLine(@"        ""command"": ""dotnet"",");
Console.Error.WriteLine(@"        ""args"": [""run"", ""--project"", ""path/to/ServerExample""]");
Console.Error.WriteLine(@"      }");
Console.Error.WriteLine(@"    }");
Console.Error.WriteLine(@"  }");
Console.Error.WriteLine();

// Start the server (listens on stdio for MCP protocol)
await server.RunAsync();
