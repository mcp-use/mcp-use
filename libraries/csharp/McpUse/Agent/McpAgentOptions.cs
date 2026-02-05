using Microsoft.Extensions.AI;

namespace McpUse.Agent;

/// <summary>
/// Configuration options for McpAgent.
/// </summary>
public class McpAgentOptions
{
    /// <summary>
    /// Maximum number of tool-calling steps before stopping (default: 5).
    /// </summary>
    public int MaxSteps { get; set; } = 5;

    /// <summary>
    /// Whether to automatically initialize the agent on first run (default: false).
    /// </summary>
    public bool AutoInitialize { get; set; } = false;

    /// <summary>
    /// Whether to maintain conversation history between runs (default: true).
    /// </summary>
    public bool MemoryEnabled { get; set; } = true;

    /// <summary>
    /// Custom system prompt (overrides template if provided).
    /// </summary>
    public string? SystemPrompt { get; set; }

    /// <summary>
    /// Custom system prompt template with {tool_descriptions} placeholder.
    /// </summary>
    public string? SystemPromptTemplate { get; set; }

    /// <summary>
    /// Additional instructions to append to the system prompt.
    /// </summary>
    public string? AdditionalInstructions { get; set; }

    /// <summary>
    /// List of tool names that should not be available to the agent.
    /// </summary>
    public List<string> DisallowedTools { get; set; } = new();

    /// <summary>
    /// Enable verbose logging (default: false).
    /// </summary>
    public bool Verbose { get; set; } = false;

    /// <summary>
    /// Chat options passed to the LLM.
    /// </summary>
    public ChatOptions? ChatOptions { get; set; }
}
