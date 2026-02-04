using System.Text;
using Microsoft.Extensions.AI;

namespace McpUse.Agent.Prompts;

/// <summary>
/// Builds system prompts dynamically based on available tools.
/// </summary>
public static class SystemPromptBuilder
{
    /// <summary>
    /// Create a system prompt with tool descriptions.
    /// </summary>
    /// <param name="tools">Available tools.</param>
    /// <param name="template">Optional custom template (use {tool_descriptions} placeholder).</param>
    /// <param name="additionalInstructions">Optional additional instructions.</param>
    /// <returns>The formatted system prompt.</returns>
    public static string CreateSystemPrompt(
        IEnumerable<AIFunction> tools,
        string? template = null,
        string? additionalInstructions = null)
    {
        template ??= SystemPromptTemplates.Default;

        var toolDescriptions = BuildToolDescriptions(tools);

        return template
            .Replace("{tool_descriptions}", toolDescriptions)
            .Replace("{additional_instructions}", additionalInstructions ?? string.Empty)
            .Trim();
    }

    /// <summary>
    /// Build formatted tool descriptions for the system prompt.
    /// </summary>
    /// <param name="tools">Available tools.</param>
    /// <returns>Formatted tool descriptions.</returns>
    public static string BuildToolDescriptions(IEnumerable<AIFunction> tools)
    {
        var toolList = tools.ToList();

        if (toolList.Count == 0)
            return "No tools available.";

        var sb = new StringBuilder();
        sb.AppendLine("Available tools:");
        sb.AppendLine();

        foreach (var tool in toolList)
        {
            sb.AppendLine($"- **{tool.Name}**: {tool.Description ?? "No description"}");

            // Add parameter info from JsonSchema if available
            if (tool.JsonSchema.ValueKind == System.Text.Json.JsonValueKind.Object &&
                tool.JsonSchema.TryGetProperty("properties", out var properties))
            {
                var requiredProps = new HashSet<string>();
                if (tool.JsonSchema.TryGetProperty("required", out var requiredArray) &&
                    requiredArray.ValueKind == System.Text.Json.JsonValueKind.Array)
                {
                    foreach (var req in requiredArray.EnumerateArray())
                    {
                        requiredProps.Add(req.GetString() ?? "");
                    }
                }

                sb.AppendLine("  Parameters:");
                foreach (var prop in properties.EnumerateObject())
                {
                    var paramDesc = "No description";
                    if (prop.Value.TryGetProperty("description", out var descProp))
                    {
                        paramDesc = descProp.GetString() ?? "No description";
                    }
                    var required = requiredProps.Contains(prop.Name) ? " (required)" : " (optional)";
                    sb.AppendLine($"    - {prop.Name}: {paramDesc}{required}");
                }
            }
            sb.AppendLine();
        }

        return sb.ToString().TrimEnd();
    }

    /// <summary>
    /// Create a ChatMessage for the system prompt.
    /// </summary>
    /// <param name="tools">Available tools.</param>
    /// <param name="template">Optional custom template.</param>
    /// <param name="additionalInstructions">Optional additional instructions.</param>
    /// <returns>A system ChatMessage.</returns>
    public static ChatMessage CreateSystemMessage(
        IEnumerable<AIFunction> tools,
        string? template = null,
        string? additionalInstructions = null)
    {
        var content = CreateSystemPrompt(tools, template, additionalInstructions);
        return new ChatMessage(ChatRole.System, content);
    }
}
