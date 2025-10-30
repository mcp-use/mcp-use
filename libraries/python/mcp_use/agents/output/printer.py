"""
Pretty printer using rich library.

This module provides the core printing functionality using rich
for terminal output with tables, colors, and live updates.
"""

import json
from typing import Any

from pydantic import BaseModel
from rich import box
from rich.console import Console, Group
from rich.json import JSON
from rich.live import Live
from rich.markdown import Markdown
from rich.panel import Panel
from rich.status import Status
from rich.text import Text

from mcp_use.agents.output.config import OutputConfig


def escape_markdown_tags(content: str, tags: set[str]) -> str:
    """Escape special tags in markdown content."""
    escaped_content = content
    for tag in tags:
        # Escape opening tag
        escaped_content = escaped_content.replace(f"<{tag}>", f"&lt;{tag}&gt;")
        # Escape closing tag
        escaped_content = escaped_content.replace(f"</{tag}>", f"&lt;/{tag}&gt;")
    return escaped_content


class PanelPrinter:
    """Clean panel-based printer for agent outputs."""

    def __init__(self, config: OutputConfig | None = None):
        """
        Initialize the panel printer.

        Args:
            config: Output configuration (uses defaults if None)
        """
        self.config = config or OutputConfig()
        self.console = Console()

    def print_message_and_response(
        self,
        query: str,
        response: Any,
        execution_time_s: float | None = None,
        steps: list[dict[str, Any]] | None = None,
    ) -> None:
        """
        Print query and response in separate panels.

        Args:
            query: The user's query/message
            response: The agent's response
            execution_time_s: Execution time in seconds
            steps: Optional reasoning steps to display
        """
        panels = []

        # Message panel
        if self.config.show_message:
            message_panel = self._create_message_panel(query)
            panels.append(message_panel)

        # Reasoning steps panels
        if self.config.show_steps and steps:
            for i, step in enumerate(steps, 1):
                step_panel = self._create_step_panel(step, i)
                panels.append(step_panel)

        response_panel = self._create_response_panel(response, execution_time_s)
        panels.append(response_panel)

        # Print all panels
        for panel in panels:
            self.console.print(panel)

    def print_error(
        self,
        error: str,
        query: str | None = None,
    ) -> None:
        """
        Print error in a panel.

        Args:
            error: Error message
            query: Optional query that caused the error
        """
        panels = []

        error_panel = Panel(
            Text(f"{error}", style="white"),
            title="Error",
            title_align="left",
            border_style="red",
            box=box.HEAVY,
            expand=True,
            padding=(1, 1),
        )
        panels.append(error_panel)

        for panel in panels:
            self.console.print(panel)

    def _create_message_panel(self, query: str) -> Panel:
        """Create a message panel for user query."""
        return Panel(
            Text(query, style="green"),
            title="Message",
            title_align="left",
            border_style="cyan",
            box=box.HEAVY,
            expand=True,
            padding=(1, 1),
        )

    def _create_response_panel(
        self,
        response: Any,
        execution_time_s: float | None = None,
    ) -> Panel:
        """Create a response panel for agent output."""
        box_style = getattr(box, self.config.response_box_style, box.ROUNDED)

        content = self._format_content(response)

        # Create title with optional timing
        if self.config.show_timing and execution_time_s is not None:
            title = (
                f"[{self.config.response_border_style}]Response ({execution_time_s:.1f}s)"
                f"[/{self.config.response_border_style}]"
            )

        else:
            title = f"[{self.config.response_border_style}]Response[/{self.config.response_border_style}]"

        return Panel(
            content,
            title=title,
            border_style=self.config.response_border_style,
            box=box_style,
        )

    def _create_step_panel(self, step: dict[str, Any], step_num: int) -> Panel:
        """Create a panel for a reasoning step."""
        box_style = getattr(box, self.config.step_box_style, box.ROUNDED)

        step_text = Text()

        if step.get("type") == "tool_call":
            tool_name = step.get("tool_name", "Unknown")
            tool_input = step.get("input", "")
            step_text.append(f"🔧 Tool: {tool_name}\n", style="bold cyan")

            # Truncate input for display
            if len(str(tool_input)) > self.config.max_step_display_length:
                tool_input = str(tool_input)[: self.config.max_step_display_length] + "..."
            step_text.append(f"Input: {tool_input}", style="dim")

        elif step.get("type") == "tool_result":
            result = step.get("result", "")

            # Truncate result for display
            if len(str(result)) > self.config.max_step_display_length:
                result = str(result)[: self.config.max_step_display_length] + "..."
            step_text.append(f"📄 Result: {result}", style="green")

        elif step.get("type") == "thinking":
            content = step.get("content", "")

            # Truncate thinking for display
            if len(content) > self.config.max_step_display_length:
                content = content[: self.config.max_step_display_length] + "..."
            step_text.append(f"💭 {content}", style="yellow")

        return Panel(
            step_text,
            title=f"[{self.config.step_border_style}]Step {step_num}[/{self.config.step_border_style}]",
            border_style=self.config.step_border_style,
            box=box_style,
        )

    def _format_content(self, content: Any) -> Any:
        """Format content based on type (NO truncation for final output)."""
        if content is None:
            return ""

        if isinstance(content, str):
            if self.config.markdown:
                return Markdown(content)
            return content

        if isinstance(content, BaseModel):
            try:
                return JSON(content.model_dump_json(exclude_none=True), indent=2)
            except Exception:
                return str(content)

        # For other types, try JSON serialization
        try:
            return JSON(json.dumps(content, indent=2))
        except (TypeError, ValueError):
            return str(content)


class StreamPrinter:
    """Panel-based printer for streaming agent outputs with live updates."""

    def __init__(self, config: OutputConfig | None = None):
        """
        Initialize the stream printer.

        Args:
            config: Output configuration (uses defaults if None)
        """
        self.config = config or OutputConfig()
        self.console = Console()
        self.live: Live | None = None
        self.start_time: float | None = None
        self.steps: list[dict[str, Any]] = []
        self.response_content: str = ""

    async def run_with_panels(
        self,
        query: str,
        agent_stream,
        stream_intermediate_steps: bool = False,
    ) -> Any:
        """
        Run agent stream with live panel updates.

        Args:
            query: User's query
            agent_stream: Async generator from agent
            stream_intermediate_steps: Whether to show steps during streaming

        Returns:
            Final result from agent
        """
        from time import time

        self.start_time = time()
        panels = []

        with Live(console=self.console, refresh_per_second=10) as live:
            self.live = live

            # 1. Show spinner while working
            status = Status("Thinking...", spinner="aesthetic", speed=0.4, refresh_per_second=10)
            live.update(status)

            # 2. Add message panel
            panels = [status]
            if self.config.show_message:
                message_panel = self._create_message_panel(query)
                panels.append(message_panel)
                live.update(Group(*panels))

            # 3. Process stream
            final_result = None
            async for item in agent_stream:
                if isinstance(item, tuple) and len(item) == 2:
                    # Step: (AgentAction, observation)
                    action, observation = item

                    if stream_intermediate_steps and self.config.show_steps:
                        # Add step to display
                        tool_name = getattr(action, "tool", None)
                        tool_input = getattr(action, "tool_input", None)

                        if tool_name:
                            self.steps.append(
                                {
                                    "type": "tool_call",
                                    "tool_name": tool_name,
                                    "input": tool_input,
                                    "result": observation,
                                }
                            )

                            # Update live display with steps
                            panels = [status]
                            if self.config.show_message:
                                panels.append(self._create_message_panel(query))

                            # Show only last 3 steps during streaming
                            for i, s in enumerate(self.steps[-3:], len(self.steps) - min(3, len(self.steps)) + 1):
                                panels.append(self._create_step_panel(s, i))

                            live.update(Group(*panels))

                elif isinstance(item, str):
                    final_result = item
                    self.response_content = item

                else:
                    final_result = item
                    self.response_content = str(item)

            # 4. Add final response panel
            execution_time_s = time() - self.start_time

            response_panel = self._create_response_panel(final_result, execution_time_s)

            # Final panel set: message + (optional steps) + response
            panels = []
            if self.config.show_message:
                panels.append(self._create_message_panel(query))

            if self.config.show_steps and self.steps:
                for i, step in enumerate(self.steps, 1):
                    panels.append(self._create_step_panel(step, i))

            panels.append(response_panel)

            # remove spinner
            live.update(Group(*panels))

        return final_result

    def _create_message_panel(self, query: str) -> Panel:
        """Create a message panel for user query."""
        return Panel(
            Text(query, style="green"),
            title="Message",
            title_align="left",
            border_style="cyan",
            box=box.HEAVY,
            expand=True,
            padding=(1, 1),
        )

    def _create_response_panel(
        self,
        response: Any,
        execution_time_s: float,
    ) -> Panel:
        """Create a response panel for agent output."""
        response_str = str(response)

        error_keywords = ["error", "error code", "failed", "exception"]
        is_error = any(keyword in response_str.lower() for keyword in error_keywords)

        if is_error:
            return Panel(
                Text(response_str, style="white"),
                title="Error",
                title_align="left",
                border_style="red",
                box=box.HEAVY,
                expand=True,
                padding=(1, 1),
            )

        # Normal response panel
        if isinstance(response, str):
            escaped_content = escape_markdown_tags(response, {"think", "thinking"})
            content = Markdown(escaped_content)
        elif isinstance(response, BaseModel):
            try:
                content = JSON(response.model_dump_json(exclude_none=True), indent=2)
            except Exception:
                content = str(response)
        else:
            try:
                content = JSON(json.dumps(response, indent=2))
            except (TypeError, ValueError):
                content = str(response)

        title = f"Response ({execution_time_s:.1f}s)"

        return Panel(
            content,
            title=title,
            title_align="left",
            border_style="blue",
            box=box.HEAVY,
            expand=True,
            padding=(1, 1),
        )

    def _create_step_panel(self, step: dict[str, Any], step_num: int) -> Panel:
        """Create a panel for a reasoning step."""

        step_text = Text()

        if step.get("type") == "tool_call":
            tool_name = step.get("tool_name", "Unknown")
            tool_input = step.get("input", "")
            result = step.get("result", "")

            step_text.append(f"🔧 Tool: {tool_name}\n", style="bold cyan")
            step_text.append(f"Input: {tool_input}\n", style="dim")

            if result:
                step_text.append(f"Result: {result}", style="green")

        return Panel(
            step_text,
            title=f"Reasoning step {step_num}",
            title_align="left",
            border_style="green",
            box=box.HEAVY,
            expand=True,
            padding=(1, 1),
        )
