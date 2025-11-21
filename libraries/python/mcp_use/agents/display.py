import json
import logging
import re

from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.pretty import Pretty

console = Console()
logger = logging.getLogger(__name__)

# Set code theme as a global variable
CODE_THEME = "stata-dark"


def _extract_json_from_textcontent(result):
    """Extract JSON from TextContent objects in result string."""
    result_str = str(result)

    # Try to extract JSON between text=' and ', annotations=
    # Use greedy matching since we know the specific end pattern
    pattern = r"text='(.*)',\s*annotations="
    match = re.search(pattern, result_str, re.DOTALL)

    if match:
        json_str = match.group(1)
        # Unescape the string - Python's str() escapes quotes and backslashes
        json_str = json_str.replace("\\'", "'")
        json_str = json_str.replace("\\\\", "\\")
        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            pass

    return None


def _render_content(content):
    """Render content with appropriate syntax highlighting using markdown code blocks."""
    if content is None:
        return Markdown("```\nNone\n```", code_theme=CODE_THEME)

    content_str = str(content) if not isinstance(content, str) else content
    content_str_stripped = content_str.strip()

    # Try to detect and render JSON
    if content_str_stripped.startswith(("{", "[")):
        try:
            parsed = json.loads(content_str_stripped)
            formatted = json.dumps(parsed, indent=2)
            return Markdown(f"```json\n{formatted}\n```", code_theme=CODE_THEME)
        except json.JSONDecodeError:
            pass

    # For dicts and lists, convert to JSON
    if isinstance(content, dict | list):
        try:
            formatted = json.dumps(content, indent=2)
            return Markdown(f"```json\n{formatted}\n```", code_theme=CODE_THEME)
        except (TypeError, ValueError):
            pass

    # If it already has markdown code blocks, render as is
    if "```" in content_str:
        return Markdown(content_str, code_theme=CODE_THEME)

    # Detect markdown patterns (headers, lists)
    if re.search(r"^#{1,6}\s|^\*\s|^-\s", content_str_stripped, re.MULTILINE):
        return Markdown(content_str, code_theme=CODE_THEME)

    # Detect code patterns
    if "\n" in content_str and any(kw in content_str for kw in ["def ", "class ", "import ", "function ", "const "]):
        # Try to detect language
        if "def " in content_str or "import " in content_str:
            return Markdown(f"```python\n{content_str}\n```", code_theme=CODE_THEME)
        elif "function " in content_str or "const " in content_str:
            return Markdown(f"```javascript\n{content_str}\n```", code_theme=CODE_THEME)

    # Default: plain text in markdown code block
    return Markdown(f"```\n{content_str}\n```", code_theme=CODE_THEME)


def _pretty_print_step(item):
    """Pretty print agent step using rich formatting."""
    if isinstance(item, tuple) and len(item) == 2:
        action, result = item
        tool_name = getattr(action, "tool", None)
        tool_input = getattr(action, "tool_input", {})

        console.print()  # Empty line before tool

        if tool_input:
            if tool_name == "execute_code" and "code" in tool_input:
                code = tool_input["code"]
                code_md = Markdown(f"```python\n{code}\n```", code_theme=CODE_THEME)
                title = f"[dim]🔧[/dim] [bold white]{tool_name}[/bold white] [dim]Input[/dim]"
                console.print(Panel(code_md, title=title, border_style="dim white", padding=(0, 1)))

                other_inputs = {k: v for k, v in tool_input.items() if k != "code"}
                if other_inputs:
                    console.print(
                        Panel(
                            _render_content(other_inputs),
                            title="[dim]Other Parameters[/dim]",
                            border_style="dim white",
                            padding=(0, 1),
                        )
                    )
            else:
                title = f"[dim]🔧[/dim] [bold white]{tool_name}[/bold white] [dim]Input[/dim]"
                console.print(
                    Panel(
                        _render_content(tool_input),
                        title=title,
                        border_style="dim white",
                        padding=(0, 1),
                    )
                )

        if result:
            parsed_json = _extract_json_from_textcontent(result)
            if parsed_json:
                if tool_name == "execute_code" and isinstance(parsed_json, dict):
                    execution_time = parsed_json.get("execution_time")
                    time_str = f" [dim]⏱️  {execution_time:.3f}s[/dim]" if execution_time is not None else ""

                    has_logs = "logs" in parsed_json and parsed_json["logs"]
                    has_result = "result" in parsed_json and parsed_json["result"] is not None

                    if has_result:
                        # Add execution time to Result only if there are no logs (logs will get the time)
                        result_title = f"[dim]Result[/dim]{time_str}" if not has_logs else "[dim]Result[/dim]"
                        console.print(
                            Panel(
                                _render_content(parsed_json["result"]),
                                title=result_title,
                                border_style="dim white",
                                padding=(0, 1),
                            )
                        )

                    if has_logs:
                        # Add execution time to Logs panel (last panel)
                        console.print(
                            Panel(
                                _render_content(parsed_json["logs"]),
                                title=f"[dim]Logs[/dim]{time_str}",
                                border_style="dim white",
                                padding=(0, 1),
                            )
                        )

                    if "error" in parsed_json and parsed_json["error"] is not None:
                        console.print(
                            Panel(
                                _render_content(parsed_json["error"]),
                                title="[dim red]Error[/dim red]",
                                border_style="red",
                                padding=(0, 1),
                            )
                        )
                else:
                    console.print(
                        Panel(
                            _render_content(parsed_json),
                            title="[dim]Result[/dim]",
                            border_style="dim white",
                            padding=(0, 1),
                        )
                    )
            else:
                console.print(
                    Panel(
                        _render_content(result),
                        title="[dim]Result[/dim]",
                        border_style="dim white",
                        padding=(0, 1),
                    )
                )
    else:
        console.print(Pretty(item))


def _log_step(item):
    """Log agent step using logger.info with emoji messages."""
    if isinstance(item, tuple) and len(item) == 2:
        action, result = item
        tool_name = getattr(action, "tool", None)
        tool_input = getattr(action, "tool_input", {})

        tool_input_str = str(tool_input)
        if len(tool_input_str) > 100:
            tool_input_str = tool_input_str[:97] + "..."
        logger.info(f"🔧 Tool call: {tool_name} with input: {tool_input_str}")

        observation_str = str(result)
        if len(observation_str) > 100:
            observation_str = observation_str[:97] + "..."
        observation_str = observation_str.replace("\n", " ")
        logger.info(f"📄 Tool result: {observation_str}")
    else:
        logger.info(f"Agent step: {item}")


def log_agent_step(item, pretty_print=True):
    """Display or log an agent step based on pretty_print flag."""
    if pretty_print:
        _pretty_print_step(item)
    else:
        _log_step(item)


def log_agent_stream(chunk, pretty_print=True):
    """Handle streaming events from astream_events.

    Args:
        chunk: Event dictionary from LangChain's astream_events
        pretty_print: If True, use rich formatting. If False, do nothing.
    """
    if not pretty_print:
        return

    event_type = chunk.get("event")
    event_data = chunk.get("data", {})
    name = chunk.get("name", "")

    # Only process specific event types we care about
    if event_type not in ("on_tool_start", "on_tool_end", "on_chat_model_stream"):
        return

    # Handle tool start events
    if event_type == "on_tool_start":
        tool_input = event_data.get("input", {})
        tool_name = name.split("/")[-1] if "/" in name else name
        console.print()  # Empty line before tool
        if tool_input:
            if tool_name == "execute_code" and "code" in tool_input:
                code = tool_input["code"]
                code_md = Markdown(f"```python\n{code}\n```", code_theme=CODE_THEME)
                title = f"[dim]🔧[/dim] [bold white]{tool_name}[/bold white] [dim]Input[/dim]"
                console.print(Panel(code_md, title=title, border_style="dim white", padding=(0, 1)))
                other_inputs = {k: v for k, v in tool_input.items() if k != "code"}
                if other_inputs:
                    console.print(
                        Panel(
                            _render_content(other_inputs),
                            title="[dim]Other Parameters[/dim]",
                            border_style="dim white",
                            padding=(0, 1),
                        )
                    )
            else:
                title = f"[dim]🔧[/dim] [bold white]{tool_name}[/bold white] [dim]Input[/dim]"
                console.print(
                    Panel(
                        _render_content(tool_input),
                        title=title,
                        border_style="dim white",
                        padding=(0, 1),
                    )
                )

    # Handle tool end events
    elif event_type == "on_tool_end":
        output = event_data.get("output", "")

        if output:
            # Extract content from ToolMessage if it's a ToolMessage object
            output_str = None
            if hasattr(output, "content"):
                content = output.content
                # Handle list of TextContent objects
                if isinstance(content, list) and content:
                    # Try to extract text from TextContent objects
                    text_contents = []
                    for item in content:
                        if hasattr(item, "text"):
                            text_contents.append(item.text)
                        elif isinstance(item, dict) and "text" in item:
                            text_contents.append(item["text"])
                    if text_contents:
                        output_str = text_contents[0] if len(text_contents) == 1 else str(text_contents)
                    else:
                        output_str = str(content)
                elif isinstance(content, str):
                    output_str = content
                else:
                    output_str = str(content)
            elif isinstance(output, dict) and "content" in output:
                output_str = str(output["content"])
            else:
                output_str = str(output)

            parsed_json = _extract_json_from_textcontent(output_str) if output_str else None
            if parsed_json:
                tool_name = name.split("/")[-1] if "/" in name else name
                if tool_name == "execute_code" and isinstance(parsed_json, dict):
                    execution_time = parsed_json.get("execution_time")
                    time_str = f" [dim]⏱️  {execution_time:.3f}s[/dim]" if execution_time is not None else ""

                    has_logs = "logs" in parsed_json and parsed_json["logs"]
                    has_result = "result" in parsed_json and parsed_json["result"] is not None

                    if has_result:
                        # Add execution time to Result only if there are no logs (logs will get the time)
                        result_title = f"[dim]Result[/dim]{time_str}" if not has_logs else "[dim]Result[/dim]"
                        console.print(
                            Panel(
                                _render_content(parsed_json["result"]),
                                title=result_title,
                                border_style="dim white",
                                padding=(0, 1),
                            )
                        )

                    if has_logs:
                        # Add execution time to Logs panel (last panel)
                        console.print(
                            Panel(
                                _render_content(parsed_json["logs"]),
                                title=f"[dim]Logs[/dim]{time_str}",
                                border_style="dim white",
                                padding=(0, 1),
                            )
                        )

                    if "error" in parsed_json and parsed_json["error"] is not None:
                        console.print(
                            Panel(
                                _render_content(parsed_json["error"]),
                                title="[dim red]Error[/dim red]",
                                border_style="red",
                                padding=(0, 1),
                            )
                        )
                else:
                    console.print(
                        Panel(
                            _render_content(parsed_json),
                            title="[dim]Result[/dim]",
                            border_style="dim white",
                            padding=(0, 1),
                        )
                    )
            else:
                console.print(
                    Panel(
                        _render_content(output_str),
                        title="[dim]Result[/dim]",
                        border_style="dim white",
                        padding=(0, 1),
                    )
                )

    # Handle chat model streaming text chunks
    elif event_type == "on_chat_model_stream":
        chunk_obj = event_data.get("chunk")
        if chunk_obj is None:
            return

        # Extract text from AIMessageChunk content
        text_parts = []

        # Try to get content from chunk object
        content = chunk_obj.content if hasattr(chunk_obj, "content") else None
        if content is not None:
            item: dict
            for item in content:
                # Extract text from various possible fields
                if "text" in item and item.get("type") != "input_json_delta":
                    text_parts.append(item["text"])
                # Skip partial_json - these are tool call arguments being built

        text = "".join(text_parts)
        if text:
            # Render text as markdown with custom code block renderer
            print(text, end="", flush=True)
            # console.print(Markdown(text, code_theme=CODE_THEME), end="\r")
