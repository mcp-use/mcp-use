"""
MCP Conformance Test Server (Python)

This server implements all supported MCP features to maximize conformance test pass rate.
Uses the exact tool/resource/prompt names expected by the MCP conformance test suite.
Run with: python conformance_server.py --transport streamable-http
"""

import argparse
import asyncio
import base64
import json
from dataclasses import dataclass
from typing import get_args

from mcp.server.fastmcp.prompts.base import UserMessage
from mcp.types import (
    AudioContent,
    Completion,
    EmbeddedResource,
    ImageContent,
    SamplingMessage,
    TextContent,
    TextResourceContents,
)

from mcp_use.server import Context, MCPServer
from mcp_use.server.types import TransportType

# Create server instance
mcp = MCPServer(
    name="ConformanceTestServer",
    version="1.0.0",
    instructions="MCP Conformance Test Server implementing all supported features.",
)

# =============================================================================
# Override completion handler with custom completions for this server
# (logging/setLevel, subscribe/unsubscribe are auto-registered by MCPServer)
# =============================================================================


@mcp.completion()
async def handle_completion(ref, argument, context=None):
    """Return completions for resource template parameters and prompt arguments."""
    # Completions for resource template parameters
    if hasattr(ref, "uri") and "template" in str(getattr(ref, "uri", "")):
        if argument.name == "id":
            values = [v for v in ["foo", "bar", "baz", "qux"] if v.startswith(argument.value)]
            return Completion(values=values, total=len(values), hasMore=False)
    # Completions for prompt arguments
    if hasattr(ref, "name"):
        if argument.name == "arg1":
            values = [v for v in ["default1", "option1"] if v.startswith(argument.value)]
            return Completion(values=values, total=len(values), hasMore=False)
        if argument.name == "arg2":
            values = [v for v in ["default2", "option2"] if v.startswith(argument.value)]
            return Completion(values=values, total=len(values), hasMore=False)
    return Completion(values=[], total=0, hasMore=False)


# =============================================================================
# TOOLS (exact names expected by conformance tests)
# =============================================================================

# 1x1 red PNG pixel for image tests
RED_PIXEL_PNG = base64.b64encode(
    bytes(
        [
            0x89,
            0x50,
            0x4E,
            0x47,
            0x0D,
            0x0A,
            0x1A,
            0x0A,
            0x00,
            0x00,
            0x00,
            0x0D,
            0x49,
            0x48,
            0x44,
            0x52,
            0x00,
            0x00,
            0x00,
            0x01,
            0x00,
            0x00,
            0x00,
            0x01,
            0x08,
            0x02,
            0x00,
            0x00,
            0x00,
            0x90,
            0x77,
            0x53,
            0xDE,
            0x00,
            0x00,
            0x00,
            0x0C,
            0x49,
            0x44,
            0x41,
            0x54,
            0x08,
            0xD7,
            0x63,
            0xF8,
            0xCF,
            0xC0,
            0x00,
            0x00,
            0x00,
            0x03,
            0x00,
            0x01,
            0x00,
            0x05,
            0xFE,
            0xD4,
            0x00,
            0x00,
            0x00,
            0x00,
            0x49,
            0x45,
            0x4E,
            0x44,
            0xAE,
            0x42,
            0x60,
            0x82,
        ]
    )
).decode("ascii")

# Minimal valid WAV file: 44-byte header + 1 sample (silence for 8-bit PCM)
SILENT_WAV_BASE64 = "UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAABAAgAZGF0YQIAAACA"


# tools-call-simple-text
@mcp.tool(name="test_simple_text")
def test_simple_text(message: str = "Hello, World!") -> str:
    """A simple tool that returns text content."""
    return f"Echo: {message}"


# tools-call-image (conformance expects: test_image_content)
@mcp.tool(name="test_image_content")
async def test_image_content() -> ImageContent:
    """A tool that returns image content."""
    return ImageContent(type="image", data=RED_PIXEL_PNG, mimeType="image/png")


# tools-call-audio (conformance expects: test_audio_content)
@mcp.tool(name="test_audio_content")
async def test_audio_content() -> AudioContent:
    """A tool that returns audio content."""
    return AudioContent(type="audio", data=SILENT_WAV_BASE64, mimeType="audio/wav")


# tools-call-embedded-resource
@mcp.tool(name="test_embedded_resource")
async def test_embedded_resource() -> EmbeddedResource:
    """A tool that returns an embedded resource."""
    return EmbeddedResource(
        type="resource",
        resource=TextResourceContents(
            uri="test://embedded",
            mimeType="text/plain",
            text="This is embedded resource content",
        ),
    )


# tools-call-mixed-content (conformance expects: test_multiple_content_types)
@mcp.tool(name="test_multiple_content_types")
async def test_multiple_content_types() -> list:
    """A tool that returns mixed content (text + image + resource)."""
    return [
        TextContent(type="text", text="Multiple content types test:"),
        ImageContent(type="image", data=RED_PIXEL_PNG, mimeType="image/png"),
        EmbeddedResource(
            type="resource",
            resource=TextResourceContents(
                uri="test://mixed-content-resource",
                mimeType="application/json",
                text=json.dumps({"test": "data", "value": 123}),
            ),
        ),
    ]


# tools-call-with-logging (conformance expects: test_tool_with_logging)
@mcp.tool(name="test_tool_with_logging")
async def test_tool_with_logging(ctx: Context) -> str:
    """A tool that sends log messages during execution."""
    await ctx.info("Tool execution started")
    await asyncio.sleep(0.05)
    await ctx.info("Tool processing data")
    await asyncio.sleep(0.05)
    await ctx.info("Tool execution completed")
    return "Tool execution completed with logging"


# tools-call-with-progress (steps is optional with default)
@mcp.tool(name="test_tool_with_progress")
async def test_tool_with_progress(ctx: Context, steps: int = 5) -> str:
    """A tool that reports progress."""
    for i in range(steps):
        await ctx.report_progress(progress=i + 1, total=steps)
        await asyncio.sleep(0.01)
    return f"Completed {steps} steps"


# tools-call-sampling
@mcp.tool(name="test_sampling")
async def test_sampling(ctx: Context, prompt: str = "Hello") -> str:
    """A tool that uses client LLM sampling."""
    message = SamplingMessage(role="user", content=TextContent(type="text", text=prompt))
    response = await ctx.sample(messages=[message])

    if isinstance(response.content, TextContent):
        return response.content.text
    return str(response.content)


# tools-call-elicitation
@dataclass
class UserInput:
    name: str = "Anonymous"
    age: int = 0


@mcp.tool(name="test_elicitation")
async def test_elicitation(ctx: Context) -> str:
    """A tool that uses elicitation to get user input."""
    result = await ctx.elicit(message="Please provide your information", schema=UserInput)
    if result.action == "accept":
        return f"Received: {result.data.name}, age {result.data.age}"
    elif result.action == "decline":
        return "User declined"
    return "Operation cancelled"


# tools-call-elicitation-sep1034-defaults
# Uses raw JSON Schema via session.elicit_form() because the upstream MCP SDK
# validation rejects Literal types needed for enum fields
@mcp.tool(name="test_elicitation_sep1034_defaults")
async def test_elicitation_sep1034_defaults(ctx: Context) -> str:
    """A tool that uses elicitation with default values for all primitive types (SEP-1034)."""
    schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string", "default": "John Doe"},
            "age": {"type": "integer", "default": 30},
            "score": {"type": "number", "default": 95.5},
            "status": {
                "type": "string",
                "enum": ["active", "inactive", "pending"],
                "default": "active",
            },
            "verified": {"type": "boolean", "default": True},
        },
    }
    session = ctx.request_context.session
    result = await session.elicit_form(
        message="Please provide your information",
        requestedSchema=schema,
        related_request_id=ctx.request_id,
    )
    if result.action == "accept":
        return f"Elicitation completed: action=accept, content={json.dumps(result.content)}"
    elif result.action == "decline":
        return "Elicitation completed: action=decline"
    return "Elicitation completed: action=cancel"


# tools-call-elicitation-sep1330-enums (requires raw JSON Schema for complex enum variants)
@mcp.tool(name="test_elicitation_sep1330_enums")
async def test_elicitation_sep1330_enums(ctx: Context) -> str:
    """A tool that uses elicitation with all 5 SEP-1330 enum variants."""
    # Build the exact JSON Schema the conformance test expects
    schema = {
        "type": "object",
        "properties": {
            "untitledSingle": {
                "type": "string",
                "enum": ["option1", "option2", "option3"],
            },
            "titledSingle": {
                "type": "string",
                "oneOf": [
                    {"const": "value1", "title": "First Option"},
                    {"const": "value2", "title": "Second Option"},
                    {"const": "value3", "title": "Third Option"},
                ],
            },
            "legacyEnum": {
                "type": "string",
                "enum": ["opt1", "opt2", "opt3"],
                "enumNames": ["Option One", "Option Two", "Option Three"],
            },
            "untitledMulti": {
                "type": "array",
                "items": {
                    "type": "string",
                    "enum": ["option1", "option2", "option3"],
                },
            },
            "titledMulti": {
                "type": "array",
                "items": {
                    "anyOf": [
                        {"const": "value1", "title": "First Choice"},
                        {"const": "value2", "title": "Second Choice"},
                        {"const": "value3", "title": "Third Choice"},
                    ],
                },
            },
        },
    }
    # Use low-level session.elicit_form() for raw JSON Schema
    session = ctx.request_context.session
    result = await session.elicit_form(
        message="Please select your preferences",
        requestedSchema=schema,
        related_request_id=ctx.request_id,
    )
    if result.action == "accept":
        return f"Elicitation completed: action=accept, content={json.dumps(result.content)}"
    elif result.action == "decline":
        return "Elicitation completed: action=decline"
    return "Elicitation completed: action=cancel"


# tools-call-error
@mcp.tool(name="test_error_handling")
def test_error_handling() -> str:
    """A tool that raises an error for testing error handling."""
    raise ValueError("This is an intentional error for testing")


# =============================================================================
# RESOURCES (exact URIs expected by conformance tests)
# =============================================================================


# resources-read-text
@mcp.resource(uri="test://static-text", name="static_text", mime_type="text/plain")
def get_static_text() -> str:
    """A static text resource."""
    return "This is static text content"


# resources-read-binary
@mcp.resource(uri="test://static-binary", name="static_binary", mime_type="application/octet-stream")
def get_static_binary() -> bytes:
    """A static binary resource."""
    return bytes([0x00, 0x01, 0x02, 0x03, 0xFF, 0xFE, 0xFD])


# resources-templates-read
@mcp.resource(
    uri="test://template/{id}/data",
    name="template_resource",
    description="A templated resource",
    mime_type="application/json",
)
def get_template_resource(id: str) -> str:
    """A templated resource that accepts an ID parameter."""
    return json.dumps({"id": id, "data": f"Data for {id}"})


# resources-subscribe / resources-unsubscribe
_subscribable_value = "Initial value"


@mcp.resource(uri="test://subscribable", name="subscribable_resource", mime_type="text/plain")
def get_subscribable_resource() -> str:
    """A resource that supports subscriptions and can be updated."""
    return _subscribable_value


@mcp.tool(name="update_subscribable_resource")
async def update_subscribable_resource(newValue: str = "Updated value") -> str:
    """Update the subscribable resource and notify subscribers."""
    global _subscribable_value
    _subscribable_value = newValue
    await mcp.notify_resource_updated("test://subscribable")
    return f"Resource updated to: {newValue}"


# =============================================================================
# PROMPTS (exact names expected by conformance tests)
# =============================================================================


# prompts-get-simple
@mcp.prompt(name="test_simple_prompt", description="A simple prompt without arguments")
def test_simple_prompt() -> str:
    """A simple prompt without any arguments."""
    return "This is a simple prompt without any arguments."


# prompts-get-with-args (conformance expects arg1/arg2, not topic/style)
@mcp.prompt(name="test_prompt_with_arguments", description="A prompt that accepts arguments")
def test_prompt_with_arguments(arg1: str = "default1", arg2: str = "default2") -> str:
    """A prompt that generates content with arguments."""
    return f"Prompt with arguments: arg1='{arg1}', arg2='{arg2}'"


# prompts-get-embedded-resource
@mcp.prompt(name="test_prompt_with_embedded_resource", description="A prompt with embedded resource")
def test_prompt_with_embedded_resource(resourceUri: str = "config://embedded") -> list:
    """A prompt that includes an embedded resource."""
    return [
        UserMessage(content=TextContent(type="text", text="Here is the configuration:")),
        UserMessage(
            content=EmbeddedResource(
                type="resource",
                resource=TextResourceContents(
                    uri=resourceUri,
                    mimeType="application/json",
                    text='{"setting": "value"}',
                ),
            )
        ),
    ]


# prompts-get-with-image
@mcp.prompt(name="test_prompt_with_image", description="A prompt with image content")
def test_prompt_with_image() -> list:
    """A prompt that includes image content."""
    return [
        UserMessage(content=TextContent(type="text", text="Here is a test image:")),
        UserMessage(content=ImageContent(type="image", data=RED_PIXEL_PNG, mimeType="image/png")),
    ]


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run MCP Conformance Test Server.")
    parser.add_argument(
        "--transport",
        type=str,
        choices=get_args(TransportType),
        default="streamable-http",
        help="MCP transport type to use (default: streamable-http)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Port to run the server on (default: 8000)",
    )
    args = parser.parse_args()

    print(f"Starting MCP Conformance Test Server with transport: {args.transport}")

    mcp.run(transport=args.transport, host="127.0.0.1", port=args.port)
