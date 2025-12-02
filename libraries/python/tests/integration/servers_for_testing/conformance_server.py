"""
MCP Conformance Test Server (Python)

This server implements all supported MCP features to maximize conformance test pass rate.
Uses the exact tool/resource/prompt names expected by the MCP conformance test suite.
Run with: python conformance_server.py --transport streamable-http
"""

import argparse
import base64
import json
from dataclasses import dataclass
from typing import get_args

from mcp.types import (
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


# tools-call-simple-text
@mcp.tool(name="test_simple_text")
def test_simple_text(message: str = "Hello, World!") -> str:
    """A simple tool that returns text content."""
    return f"Echo: {message}"


# tools-call-image - Return ImageContent directly
@mcp.tool(name="test_image")
async def test_image() -> ImageContent:
    """A tool that returns image content."""
    return ImageContent(type="image", data=RED_PIXEL_PNG, mimeType="image/png")


# tools-call-embedded-resource - Return EmbeddedResource directly
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


# tools-call-mixed-content - Return list of content types
@mcp.tool(name="test_mixed_content")
async def test_mixed_content() -> list:
    """A tool that returns mixed content (text + image)."""
    return [
        TextContent(type="text", text="Here is some text content"),
        ImageContent(type="image", data=RED_PIXEL_PNG, mimeType="image/png"),
    ]


# tools-call-with-logging
@mcp.tool(name="test_logging")
async def test_logging(ctx: Context) -> str:
    """A tool that emits log messages at various levels."""
    await ctx.debug("Debug message from tool")
    await ctx.info("Info message from tool")
    await ctx.warning("Warning message from tool")
    return "Logging completed"


# tools-call-with-progress (steps is optional with default)
@mcp.tool(name="test_tool_with_progress")
async def test_tool_with_progress(ctx: Context, steps: int = 5) -> str:
    """A tool that reports progress."""
    import asyncio

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


# =============================================================================
# PROMPTS (exact names expected by conformance tests)
# All parameters are optional with defaults for conformance tests
# =============================================================================


# prompts-get-simple
@mcp.prompt(name="test_simple_prompt", description="A simple prompt without arguments")
def test_simple_prompt() -> str:
    """A simple prompt without any arguments."""
    return "This is a simple prompt without any arguments."


# prompts-get-with-args (parameters optional with defaults)
@mcp.prompt(name="test_prompt_with_arguments", description="A prompt that accepts arguments")
def test_prompt_with_arguments(topic: str = "general", style: str = "formal") -> str:
    """A prompt that generates content about a topic in a specific style."""
    return f"Please write about {topic} in a {style} style."


# prompts-get-embedded-resource (resourceUri parameter for conformance test)
@mcp.prompt(name="test_prompt_with_embedded_resource", description="A prompt with embedded resource")
def test_prompt_with_embedded_resource(resourceUri: str = "config://embedded") -> list:
    """A prompt that includes an embedded resource."""
    return [
        TextContent(type="text", text="Here is the configuration:"),
        EmbeddedResource(
            type="resource",
            resource=TextResourceContents(
                uri=resourceUri,
                mimeType="application/json",
                text='{"setting": "value"}',
            ),
        ),
    ]


# prompts-get-with-image
@mcp.prompt(name="test_prompt_with_image", description="A prompt with image content")
def test_prompt_with_image() -> list:
    """A prompt that includes image content."""
    return [
        TextContent(type="text", text="Here is a test image:"),
        ImageContent(type="image", data=RED_PIXEL_PNG, mimeType="image/png"),
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
    print("Tools: test_simple_text, test_image, test_embedded_resource, test_mixed_content,")
    print("       test_logging, test_tool_with_progress, test_sampling, test_elicitation, test_error_handling")
    print("Resources: test://static-text, test://static-binary, test://template/{id}/data")
    print("Prompts: test_simple_prompt, test_prompt_with_arguments,")
    print("         test_prompt_with_embedded_resource, test_prompt_with_image")

    mcp.run(transport=args.transport, host="127.0.0.1", port=args.port)
