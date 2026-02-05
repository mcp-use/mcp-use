using Xunit;
using McpUse.Streaming;

namespace McpUse.Tests;

/// <summary>
/// Tests for StreamEventBuilder
/// </summary>
public class StreamEventTests
{
    [Fact]
    public void StreamEventBuilder_CreatesAgentStartEvent()
    {
        // Arrange
        var runId = "test-run-123";
        var query = "Test query";

        // Act
        var evt = StreamEventBuilder.AgentStart(runId, query, step: 0);

        // Assert
        Assert.Equal(StreamEventType.AgentStart, evt.EventType);
        Assert.Equal(runId, evt.RunId);
        Assert.Equal(0, evt.Step);
    }

    [Fact]
    public void StreamEventBuilder_CreatesToolStartEvent()
    {
        // Arrange
        var runId = "test-run-123";
        var args = new Dictionary<string, object?> { ["path"] = "/tmp" };

        // Act
        var evt = StreamEventBuilder.ToolStart(runId, "read_file", args, step: 2);

        // Assert
        Assert.Equal(StreamEventType.ToolStart, evt.EventType);
        var data = Assert.IsType<ToolEventData>(evt.Data);
        Assert.Equal("read_file", data.ToolName);
    }

    [Fact]
    public void StreamEventBuilder_CreatesErrorEvent()
    {
        // Arrange
        var runId = "test-run-123";
        var exception = new Exception("Something went wrong");

        // Act
        var evt = StreamEventBuilder.Error(runId, exception, 3);

        // Assert
        Assert.Equal(StreamEventType.Error, evt.EventType);
        var data = Assert.IsType<ErrorEventData>(evt.Data);
        Assert.Equal("Something went wrong", data.Message);
    }

    [Fact]
    public void StreamEventBuilder_CreatesToolEndEvent()
    {
        // Arrange
        var runId = "test-run-123";
        var result = "Tool completed successfully";

        // Act
        var evt = StreamEventBuilder.ToolEnd(runId, "my_tool", result, isError: false, errorMessage: null, durationMs: 100, step: 1);

        // Assert
        Assert.Equal(StreamEventType.ToolEnd, evt.EventType);
        var data = Assert.IsType<ToolEventData>(evt.Data);
        Assert.Equal("my_tool", data.ToolName);
        Assert.Equal(result, data.Result);
    }

    [Fact]
    public void StreamEventBuilder_CreatesAgentEndEvent()
    {
        // Arrange
        var runId = "test-run-123";
        var result = "Final answer";

        // Act
        var evt = StreamEventBuilder.AgentEnd(runId, result, totalSteps: 5, durationMs: 1000);

        // Assert
        Assert.Equal(StreamEventType.AgentEnd, evt.EventType);
    }

    [Fact]
    public void StreamEventBuilder_CreatesLlmTokenEvent()
    {
        // Arrange
        var runId = "test-run-123";
        var token = "Hello";

        // Act
        var evt = StreamEventBuilder.LlmToken(runId, token, step: 2);

        // Assert
        Assert.Equal(StreamEventType.LlmToken, evt.EventType);
        var data = Assert.IsType<LlmEventData>(evt.Data);
        Assert.Equal("Hello", data.Token);
    }

    [Fact]
    public void StreamEvent_HasTimestamp()
    {
        // Arrange & Act
        var evt = StreamEventBuilder.AgentStart("run-1", "query", step: 0);

        // Assert
        Assert.True(evt.Timestamp <= DateTime.UtcNow);
        Assert.True(evt.Timestamp > DateTime.UtcNow.AddMinutes(-1));
    }
}
