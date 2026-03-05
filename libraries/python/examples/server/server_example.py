"""
Example mcp-use server.

Demonstrates the main building blocks of an MCP server:

- **Tools**: Functions that LLMs can invoke. Parameters are typed with
  ``Annotated[T, Field(description="...")]`` so the description is visible
  to clients and models.  Supports required, optional (with default), and
  nullable (``T | None``) parameters.  mcp-use automatically simplifies
  Pydantic's ``anyOf``/null schema into a flat ``{"type": "T"}`` for
  better compatibility with MCP clients.
- **Resources**: Static or dynamic data endpoints identified by URI.
- **Resource templates**: Parameterized URIs (e.g. ``template://{name}``).
- **Prompts**: Reusable prompt templates.
- **Annotations**: ``ToolAnnotations`` hints (readOnly, destructive, idempotent, …)
  that help clients display and filter tools.

Run with:
    python server_example.py
Then open http://localhost:8000/inspector to browse tools, resources, and prompts.
"""

from datetime import datetime
from typing import Annotated, Literal

from mcp.types import ToolAnnotations
from pydantic import Field

from mcp_use import MCPServer

server = MCPServer(
    name="Example Server",
    version="0.1.0",
    instructions="An example server showcasing tool parameter patterns.",
    debug=True,
    pretty_print_jsonrpc=True,
)


# ---------------------------------------------------------------------------
# Tool: create_event (demonstrates required, optional, and nullable params)
# ---------------------------------------------------------------------------
@server.tool(
    name="create_event",
    description="Create a calendar event. Shows required, optional, and nullable parameter patterns.",
    annotations=ToolAnnotations(readOnlyHint=False, idempotentHint=False),
)
async def create_event(
    # Required — no default, will be in the "required" array
    title: Annotated[str, Field(description="Event title")],
    date: Annotated[str, Field(description="Event date in ISO format (YYYY-MM-DD)")],
    # Enum via Literal — renders as a dropdown in the Inspector
    visibility: Annotated[
        Literal["public", "private", "team"],
        Field(description="Who can see this event"),
    ],
    # Optional with non-None defaults — not required, default shown in schema
    duration_minutes: Annotated[int, Field(description="Duration in minutes")] = 60,
    all_day: Annotated[bool, Field(description="Whether this is an all-day event")] = False,
    timezone: Annotated[str, Field(description="IANA timezone identifier")] = "UTC",
    # Optional enum with default — dropdown with a pre-selected value
    recurrence: Annotated[
        Literal["none", "daily", "weekly", "monthly"],
        Field(description="Recurrence pattern"),
    ] = "none",
    # Nullable — T | None with default None.
    # mcp-use simplifies these to {"type": "string", "default": null} instead of
    # Pydantic's {"anyOf": [{"type": "string"}, {"type": "null"}], "default": null}
    location: Annotated[str | None, Field(description="Event location or meeting URL")] = None,
    description: Annotated[str | None, Field(description="Detailed event description")] = None,
    max_attendees: Annotated[int | None, Field(description="Maximum number of attendees")] = None,
    priority: Annotated[float | None, Field(description="Priority score between 0 and 1")] = None,
    tags: Annotated[list[str] | None, Field(description="List of tags for categorization")] = None,
) -> dict:
    """Create a calendar event and return its details."""
    return {
        "title": title,
        "date": date,
        "visibility": visibility,
        "duration_minutes": duration_minutes,
        "all_day": all_day,
        "timezone": timezone,
        "recurrence": recurrence,
        "location": location,
        "description": description,
        "max_attendees": max_attendees,
        "priority": priority,
        "tags": tags,
    }


# ---------------------------------------------------------------------------
# Resource: current time
# ---------------------------------------------------------------------------
@server.resource(
    uri="time://current",
    name="current_time",
    title="Current Time",
    description="Returns the current time.",
    mime_type="text/plain",
)
async def current_time() -> str:
    return datetime.now().isoformat()


# ---------------------------------------------------------------------------
# Prompt: help
# ---------------------------------------------------------------------------
@server.prompt(name="help", title="Help", description="Returns a help message.")
async def help_prompt() -> str:
    return "This is a help message."


# ---------------------------------------------------------------------------
# Resource template
# ---------------------------------------------------------------------------
@server.resource(
    uri="template://{template_name}",
    name="template_message",
    title="Template Message",
    description="Returns a template message based on the template name parameter.",
    mime_type="text/plain",
)
async def template_message(template_name: str) -> str:
    if template_name == "help":
        return "This is a help message."
    elif template_name == "time":
        return datetime.now().isoformat()
    else:
        return "This is a template message."


if __name__ == "__main__":
    server.run(transport="streamable-http", host="127.0.0.1", port=8000)
