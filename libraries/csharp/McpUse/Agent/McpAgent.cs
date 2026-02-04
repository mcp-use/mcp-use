using McpUse.Agent.Prompts;
using McpUse.Client;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace McpUse.Agent;

/// <summary>
/// High-level AI agent that uses MCP tools to accomplish tasks.
/// </summary>
public sealed class McpAgent : IAsyncDisposable
{
    private readonly IChatClient _chatClient;
    private readonly McpUseClient _mcpClient;
    private readonly McpAgentOptions _options;
    private readonly ILogger<McpAgent> _logger;
    private readonly List<ChatMessage> _conversationHistory = new();
    private readonly List<string> _toolsUsedNames = new();

    private IList<AIFunction>? _tools;
    private ChatMessage? _systemMessage;
    private bool _initialized;
    private bool _disposed;

    /// <summary>
    /// Gets the conversation history.
    /// </summary>
    public IReadOnlyList<ChatMessage> ConversationHistory => _conversationHistory;

    /// <summary>
    /// Gets the names of tools used during execution.
    /// </summary>
    public IReadOnlyList<string> ToolsUsedNames => _toolsUsedNames;

    /// <summary>
    /// Gets whether the agent is initialized.
    /// </summary>
    public bool IsInitialized => _initialized;

    /// <summary>
    /// Gets the available tools after initialization.
    /// </summary>
    public IReadOnlyList<AIFunction>? Tools => _tools?.ToList();

    /// <summary>
    /// Creates a new MCP Agent.
    /// </summary>
    /// <param name="chatClient">The chat client (LLM) to use.</param>
    /// <param name="mcpClient">The MCP client with server configurations.</param>
    /// <param name="options">Optional agent configuration.</param>
    /// <param name="logger">Optional logger.</param>
    public McpAgent(
        IChatClient chatClient,
        McpUseClient mcpClient,
        McpAgentOptions? options = null,
        ILogger<McpAgent>? logger = null)
    {
        _chatClient = chatClient ?? throw new ArgumentNullException(nameof(chatClient));
        _mcpClient = mcpClient ?? throw new ArgumentNullException(nameof(mcpClient));
        _options = options ?? new McpAgentOptions();
        _logger = logger ?? NullLogger<McpAgent>.Instance;
    }

    /// <summary>
    /// Initialize the agent by connecting to MCP servers and discovering tools.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed) throw new ObjectDisposedException(nameof(McpAgent));
        if (_initialized) return;

        _logger.LogInformation("🚀 Initializing MCP agent...");

        // Connect to all servers
        await _mcpClient.CreateAllSessionsAsync(cancellationToken);

        // Get all tools
        _tools = await _mcpClient.GetAllToolsAsync(cancellationToken);

        // Filter out disallowed tools
        if (_options.DisallowedTools.Count > 0)
        {
            _tools = _tools
                .Where(t => !_options.DisallowedTools.Contains(t.Name))
                .ToList();
        }

        _logger.LogInformation("🛠️ Found {Count} tools", _tools.Count);

        // Create system message
        _systemMessage = CreateSystemMessage();

        _initialized = true;
        _logger.LogInformation("✨ Agent initialization complete");
    }

    /// <summary>
    /// Run a query and return the final result.
    /// </summary>
    /// <param name="query">The user's query.</param>
    /// <param name="maxSteps">Optional maximum steps override.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The agent's final response.</returns>
    public async Task<string> RunAsync(
        string query,
        int? maxSteps = null,
        CancellationToken cancellationToken = default)
    {
        if (_disposed) throw new ObjectDisposedException(nameof(McpAgent));

        // Auto-initialize if needed
        if (!_initialized)
        {
            if (_options.AutoInitialize)
            {
                await InitializeAsync(cancellationToken);
            }
            else
            {
                throw new InvalidOperationException("Agent not initialized. Call InitializeAsync first or set AutoInitialize to true.");
            }
        }

        var effectiveMaxSteps = maxSteps ?? _options.MaxSteps;
        _toolsUsedNames.Clear();

        _logger.LogDebug("Running query: {Query}", TruncateForLog(query));

        // Build messages
        var messages = BuildMessages(query);

        // Create chat options with tools
        var chatOptions = _options.ChatOptions?.Clone() ?? new ChatOptions();
        chatOptions.Tools = _tools?.Cast<AITool>().ToList() ?? new List<AITool>();

        var stepCount = 0;
        ChatMessage? lastAssistantMessage = null;

        while (stepCount < effectiveMaxSteps)
        {
            stepCount++;
            _logger.LogDebug("Step {Step}/{MaxSteps}", stepCount, effectiveMaxSteps);

            // Call the LLM
            var response = await _chatClient.GetResponseAsync(messages, chatOptions, cancellationToken);

            // Add assistant response to messages
            foreach (var message in response.Messages)
            {
                messages.Add(message);
                lastAssistantMessage = message;
            }

            // Check if there are tool calls to process
            var toolCalls = response.Messages
                .SelectMany(m => m.Contents.OfType<FunctionCallContent>())
                .ToList();

            if (toolCalls.Count == 0)
            {
                // No tool calls - we're done
                _logger.LogDebug("No tool calls, completing");
                break;
            }

            // Process tool calls
            foreach (var toolCall in toolCalls)
            {
                _logger.LogDebug("Calling tool: {Tool}", toolCall.Name);
                _toolsUsedNames.Add(toolCall.Name);

                try
                {
                    // Find and invoke the tool
                    var tool = _tools?.FirstOrDefault(t => t.Name == toolCall.Name);
                    if (tool is null)
                    {
                        var errorResult = new FunctionResultContent(
                            toolCall.CallId,
                            $"Error: Tool '{toolCall.Name}' not found");
                        messages.Add(new ChatMessage(ChatRole.Tool, [errorResult]));
                        continue;
                    }

                    var result = await tool.InvokeAsync(new AIFunctionArguments(toolCall.Arguments), cancellationToken);

                    var resultContent = new FunctionResultContent(
                        toolCall.CallId,
                        result);
                    messages.Add(new ChatMessage(ChatRole.Tool, [resultContent]));

                    _logger.LogDebug("Tool {Tool} completed", toolCall.Name);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Tool {Tool} failed", toolCall.Name);

                    var errorResult = new FunctionResultContent(
                        toolCall.CallId,
                        $"Error: {ex.Message}");
                    messages.Add(new ChatMessage(ChatRole.Tool, [errorResult]));
                }
            }
        }

        if (stepCount >= effectiveMaxSteps)
        {
            _logger.LogWarning("Agent reached max steps ({MaxSteps})", effectiveMaxSteps);
        }

        // Update conversation history
        if (_options.MemoryEnabled)
        {
            // Add user message
            _conversationHistory.Add(new ChatMessage(ChatRole.User, query));

            // Add final assistant message
            if (lastAssistantMessage is not null)
            {
                _conversationHistory.Add(lastAssistantMessage);
            }
        }

        // Extract final text response
        var finalResponse = ExtractTextContent(lastAssistantMessage);

        _logger.LogInformation("Completed in {Steps} steps using {ToolCount} tools", stepCount, _toolsUsedNames.Count);

        return finalResponse;
    }

    /// <summary>
    /// Run a query with streaming output.
    /// </summary>
    /// <param name="query">The user's query.</param>
    /// <param name="maxSteps">Optional maximum steps override.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Async enumerable of response chunks.</returns>
    public async IAsyncEnumerable<StreamingAgentUpdate> StreamAsync(
        string query,
        int? maxSteps = null,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        if (_disposed) throw new ObjectDisposedException(nameof(McpAgent));

        // Auto-initialize if needed
        if (!_initialized)
        {
            if (_options.AutoInitialize)
            {
                await InitializeAsync(cancellationToken);
            }
            else
            {
                throw new InvalidOperationException("Agent not initialized. Call InitializeAsync first or set AutoInitialize to true.");
            }
        }

        var effectiveMaxSteps = maxSteps ?? _options.MaxSteps;
        _toolsUsedNames.Clear();

        var messages = BuildMessages(query);

        var chatOptions = _options.ChatOptions?.Clone() ?? new ChatOptions();
        chatOptions.Tools = _tools?.Cast<AITool>().ToList() ?? new List<AITool>();

        var stepCount = 0;
        var accumulatedContent = new List<AIContent>();
        ChatMessage? lastAssistantMessage = null;

        while (stepCount < effectiveMaxSteps)
        {
            stepCount++;
            accumulatedContent.Clear();

            yield return new StreamingAgentUpdate
            {
                Type = UpdateType.StepStart,
                Step = stepCount,
                Message = $"Step {stepCount}/{effectiveMaxSteps}"
            };

            // Stream from LLM
            var toolCalls = new List<FunctionCallContent>();

            await foreach (var update in _chatClient.GetStreamingResponseAsync(messages, chatOptions, cancellationToken))
            {
                foreach (var content in update.Contents)
                {
                    accumulatedContent.Add(content);

                    if (content is TextContent textContent)
                    {
                        yield return new StreamingAgentUpdate
                        {
                            Type = UpdateType.Text,
                            Text = textContent.Text,
                            Step = stepCount
                        };
                    }
                    else if (content is FunctionCallContent funcCall)
                    {
                        toolCalls.Add(funcCall);
                        yield return new StreamingAgentUpdate
                        {
                            Type = UpdateType.ToolCall,
                            ToolName = funcCall.Name,
                            Step = stepCount
                        };
                    }
                }
            }

            // Add accumulated message
            lastAssistantMessage = new ChatMessage(ChatRole.Assistant, accumulatedContent.ToList());
            messages.Add(lastAssistantMessage);

            if (toolCalls.Count == 0)
            {
                break;
            }

            // Process tool calls
            foreach (var toolCall in toolCalls)
            {
                _toolsUsedNames.Add(toolCall.Name);

                yield return new StreamingAgentUpdate
                {
                    Type = UpdateType.ToolStart,
                    ToolName = toolCall.Name,
                    Step = stepCount
                };

                StreamingAgentUpdate? updateToYield = null;
                bool shouldContinue = false;

                try
                {
                    var tool = _tools?.FirstOrDefault(t => t.Name == toolCall.Name);
                    if (tool is null)
                    {
                        var errorResult = new FunctionResultContent(
                            toolCall.CallId,
                            $"Error: Tool '{toolCall.Name}' not found");
                        messages.Add(new ChatMessage(ChatRole.Tool, [errorResult]));

                        updateToYield = new StreamingAgentUpdate
                        {
                            Type = UpdateType.ToolError,
                            ToolName = toolCall.Name,
                            Error = $"Tool '{toolCall.Name}' not found",
                            Step = stepCount
                        };
                        shouldContinue = true;
                    }
                    else
                    {
                        var result = await tool.InvokeAsync(new AIFunctionArguments(toolCall.Arguments), cancellationToken);

                        var resultContent = new FunctionResultContent(
                            toolCall.CallId,
                            result);
                        messages.Add(new ChatMessage(ChatRole.Tool, [resultContent]));

                        updateToYield = new StreamingAgentUpdate
                        {
                            Type = UpdateType.ToolResult,
                            ToolName = toolCall.Name,
                            ToolResult = result?.ToString(),
                            Step = stepCount
                        };
                    }
                }
                catch (Exception ex)
                {
                    var errorResult = new FunctionResultContent(
                        toolCall.CallId,
                        $"Error: {ex.Message}");
                    messages.Add(new ChatMessage(ChatRole.Tool, [errorResult]));

                    updateToYield = new StreamingAgentUpdate
                    {
                        Type = UpdateType.ToolError,
                        ToolName = toolCall.Name,
                        Error = ex.Message,
                        Step = stepCount
                    };
                }

                if (updateToYield is not null)
                {
                    yield return updateToYield;
                }

                if (shouldContinue)
                {
                    continue;
                }
            }
        }

        // Update conversation history
        if (_options.MemoryEnabled)
        {
            _conversationHistory.Add(new ChatMessage(ChatRole.User, query));
            if (lastAssistantMessage is not null)
            {
                _conversationHistory.Add(lastAssistantMessage);
            }
        }

        yield return new StreamingAgentUpdate
        {
            Type = UpdateType.Complete,
            Step = stepCount,
            Message = $"Completed in {stepCount} steps"
        };
    }

    /// <summary>
    /// Clear the conversation history.
    /// </summary>
    public void ClearConversationHistory()
    {
        _conversationHistory.Clear();
    }

    /// <summary>
    /// Set a new system message.
    /// </summary>
    /// <param name="message">The new system message content.</param>
    public void SetSystemMessage(string message)
    {
        _systemMessage = new ChatMessage(ChatRole.System, message);
    }

    /// <summary>
    /// Set the list of disallowed tools.
    /// </summary>
    /// <param name="disallowedTools">Tools to disallow.</param>
    public void SetDisallowedTools(IEnumerable<string> disallowedTools)
    {
        _options.DisallowedTools = disallowedTools.ToList();

        // Re-filter tools if initialized
        if (_initialized && _tools is not null)
        {
            _tools = _tools
                .Where(t => !_options.DisallowedTools.Contains(t.Name))
                .ToList();
        }
    }

    private ChatMessage CreateSystemMessage()
    {
        if (!string.IsNullOrEmpty(_options.SystemPrompt))
        {
            return new ChatMessage(ChatRole.System, _options.SystemPrompt);
        }

        return SystemPromptBuilder.CreateSystemMessage(
            _tools ?? Enumerable.Empty<AIFunction>(),
            _options.SystemPromptTemplate,
            _options.AdditionalInstructions);
    }

    private List<ChatMessage> BuildMessages(string query)
    {
        var messages = new List<ChatMessage>();

        // Add system message
        if (_systemMessage is not null)
        {
            messages.Add(_systemMessage);
        }

        // Add conversation history
        if (_options.MemoryEnabled)
        {
            messages.AddRange(_conversationHistory);
        }

        // Add current query
        messages.Add(new ChatMessage(ChatRole.User, query));

        return messages;
    }

    private static string ExtractTextContent(ChatMessage? message)
    {
        if (message is null) return string.Empty;

        var textParts = message.Contents
            .OfType<TextContent>()
            .Select(t => t.Text);

        return string.Join("", textParts);
    }

    private static string TruncateForLog(string text, int maxLength = 50)
    {
        if (text.Length <= maxLength) return text;
        return text[..maxLength] + "...";
    }

    /// <inheritdoc />
    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;

        await _mcpClient.DisposeAsync();
    }
}

/// <summary>
/// Types of streaming updates from the agent.
/// </summary>
public enum UpdateType
{
    StepStart,
    Text,
    ToolCall,
    ToolStart,
    ToolResult,
    ToolError,
    Complete
}

/// <summary>
/// A streaming update from the agent.
/// </summary>
public class StreamingAgentUpdate
{
    public UpdateType Type { get; init; }
    public int Step { get; init; }
    public string? Text { get; init; }
    public string? ToolName { get; init; }
    public string? ToolResult { get; init; }
    public string? Error { get; init; }
    public string? Message { get; init; }
}
