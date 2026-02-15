/// <summary>
/// File System MCP Server
/// 
/// A pure C# MCP server that provides file system operations.
/// </summary>

using System.Text;
using System.Text.Json;
using McpUse.Server;

var rootPath = args.Length > 0 ? args[0] : Environment.CurrentDirectory;
Console.Error.WriteLine($"FileSystem Server starting with root: {rootPath}");

var options = new McpServerOptions
{
    Name = "filesystem-server",
    Version = "1.0.0",
    Transport = "stdio"
};

var server = new McpServer(options);

// List directory contents
server.AddTool(new ToolDefinition
{
    Name = "list_directory",
    Description = "Lists files and directories in a specified path",
    InputSchema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "path": { "type": "string", "description": "Path to list (relative to root)" }
        },
        "required": ["path"]
    }
    """).RootElement,
    Handler = async (arguments, cancellationToken) =>
    {
        var relativePath = arguments["path"]?.ToString() ?? ".";
        var fullPath = Path.GetFullPath(Path.Combine(rootPath, relativePath));

        // Security: ensure path is within root
        if (!fullPath.StartsWith(rootPath))
            return new { error = "Access denied: path outside root" };

        if (!Directory.Exists(fullPath))
            return new { error = $"Directory not found: {relativePath}" };

        var entries = new List<object>();

        foreach (var dir in Directory.GetDirectories(fullPath))
        {
            entries.Add(new { name = Path.GetFileName(dir), type = "directory" });
        }

        foreach (var file in Directory.GetFiles(fullPath))
        {
            var info = new FileInfo(file);
            entries.Add(new { name = Path.GetFileName(file), type = "file", size = info.Length });
        }

        return new { path = relativePath, entries };
    }
});

// Read file contents
server.AddTool(new ToolDefinition
{
    Name = "read_file",
    Description = "Reads the contents of a file",
    InputSchema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "path": { "type": "string", "description": "Path to the file (relative to root)" }
        },
        "required": ["path"]
    }
    """).RootElement,
    Handler = async (arguments, cancellationToken) =>
    {
        var relativePath = arguments["path"]?.ToString() ?? "";
        var fullPath = Path.GetFullPath(Path.Combine(rootPath, relativePath));

        if (!fullPath.StartsWith(rootPath))
            return new { error = "Access denied: path outside root" };

        if (!File.Exists(fullPath))
            return new { error = $"File not found: {relativePath}" };

        var content = await File.ReadAllTextAsync(fullPath, cancellationToken);
        return new { path = relativePath, content };
    }
});

// Write file contents
server.AddTool(new ToolDefinition
{
    Name = "write_file",
    Description = "Writes content to a file",
    InputSchema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "path": { "type": "string", "description": "Path to the file (relative to root)" },
            "content": { "type": "string", "description": "Content to write" }
        },
        "required": ["path", "content"]
    }
    """).RootElement,
    Handler = async (arguments, cancellationToken) =>
    {
        var relativePath = arguments["path"]?.ToString() ?? "";
        var content = arguments["content"]?.ToString() ?? "";
        var fullPath = Path.GetFullPath(Path.Combine(rootPath, relativePath));

        if (!fullPath.StartsWith(rootPath))
            return new { error = "Access denied: path outside root" };

        var directory = Path.GetDirectoryName(fullPath);
        if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
            Directory.CreateDirectory(directory);

        await File.WriteAllTextAsync(fullPath, content, cancellationToken);
        return new { success = true, path = relativePath, bytesWritten = Encoding.UTF8.GetByteCount(content) };
    }
});

// Create directory
server.AddTool(new ToolDefinition
{
    Name = "create_directory",
    Description = "Creates a new directory",
    InputSchema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "path": { "type": "string", "description": "Path of directory to create (relative to root)" }
        },
        "required": ["path"]
    }
    """).RootElement,
    Handler = async (arguments, cancellationToken) =>
    {
        var relativePath = arguments["path"]?.ToString() ?? "";
        var fullPath = Path.GetFullPath(Path.Combine(rootPath, relativePath));

        if (!fullPath.StartsWith(rootPath))
            return new { error = "Access denied: path outside root" };

        Directory.CreateDirectory(fullPath);
        return new { success = true, path = relativePath };
    }
});

// Delete file
server.AddTool(new ToolDefinition
{
    Name = "delete_file",
    Description = "Deletes a file",
    InputSchema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "path": { "type": "string", "description": "Path to the file to delete (relative to root)" }
        },
        "required": ["path"]
    }
    """).RootElement,
    Handler = async (arguments, cancellationToken) =>
    {
        var relativePath = arguments["path"]?.ToString() ?? "";
        var fullPath = Path.GetFullPath(Path.Combine(rootPath, relativePath));

        if (!fullPath.StartsWith(rootPath))
            return new { error = "Access denied: path outside root" };

        if (!File.Exists(fullPath))
            return new { error = $"File not found: {relativePath}" };

        File.Delete(fullPath);
        return new { success = true, path = relativePath, deleted = true };
    }
});

// Get file info
server.AddTool(new ToolDefinition
{
    Name = "get_file_info",
    Description = "Gets detailed information about a file or directory",
    InputSchema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "path": { "type": "string", "description": "Path to the file or directory (relative to root)" }
        },
        "required": ["path"]
    }
    """).RootElement,
    Handler = async (arguments, cancellationToken) =>
    {
        var relativePath = arguments["path"]?.ToString() ?? "";
        var fullPath = Path.GetFullPath(Path.Combine(rootPath, relativePath));

        if (!fullPath.StartsWith(rootPath))
            return new { error = "Access denied: path outside root" };

        if (File.Exists(fullPath))
        {
            var info = new FileInfo(fullPath);
            return new
            {
                path = relativePath,
                type = "file",
                size = info.Length,
                created = info.CreationTimeUtc,
                modified = info.LastWriteTimeUtc,
                isReadOnly = info.IsReadOnly
            };
        }

        if (Directory.Exists(fullPath))
        {
            var info = new DirectoryInfo(fullPath);
            return (object)new
            {
                path = relativePath,
                type = "directory",
                created = info.CreationTimeUtc,
                modified = info.LastWriteTimeUtc
            };
        }

        return new { error = $"Path not found: {relativePath}" };
    }
});

// Search files
server.AddTool(new ToolDefinition
{
    Name = "search_files",
    Description = "Searches for files matching a pattern",
    InputSchema = JsonDocument.Parse("""
    {
        "type": "object",
        "properties": {
            "path": { "type": "string", "description": "Directory to search in (relative to root)" },
            "pattern": { "type": "string", "description": "Search pattern (e.g., *.txt, *.cs)" }
        },
        "required": ["path", "pattern"]
    }
    """).RootElement,
    Handler = async (arguments, cancellationToken) =>
    {
        var relativePath = arguments["path"]?.ToString() ?? ".";
        var pattern = arguments["pattern"]?.ToString() ?? "*";
        var fullPath = Path.GetFullPath(Path.Combine(rootPath, relativePath));

        if (!fullPath.StartsWith(rootPath))
            return new { error = "Access denied: path outside root" };

        if (!Directory.Exists(fullPath))
            return new { error = $"Directory not found: {relativePath}" };

        var files = Directory.GetFiles(fullPath, pattern, SearchOption.AllDirectories)
            .Select(f => Path.GetRelativePath(rootPath, f))
            .Take(100)
            .ToList();

        return new { searchPath = relativePath, pattern, matches = files, count = files.Count };
    }
});

Console.Error.WriteLine($"FileSystem Server running with {7} tools");
await server.RunAsync();
