import json
import logging
import re
import textwrap

from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.pretty import Pretty
from rich.text import Text

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


def _format_search_tools_as_tree(tools, meta=None, query=None):
    """Format search_tools result as a tree structure.

    Args:
        tools: List of tool dictionaries with 'server', 'name', and optionally 'description'
        meta: Optional dictionary with 'total_tools', 'namespaces', 'result_count'
        query: Optional query string that was used for the search

    Returns:
        Formatted tree string
    """
    # Build meta information display
    meta_lines = []
    if meta:
        if meta.get("total_tools") is not None:
            meta_lines.append(f"Total tools: {meta['total_tools']}")
        if meta.get("namespaces") and len(meta["namespaces"]) > 0:
            meta_lines.append(f"Namespaces: {', '.join(meta['namespaces'])}")
        if meta.get("result_count") is not None:
            meta_lines.append(f"Results: {meta['result_count']}")

    if not isinstance(tools, list) or len(tools) == 0:
        no_results_msg = f'No tools found for query "{query}"' if query else "(no tools found)"
        if meta_lines:
            return "\n".join(meta_lines) + "\n\n" + no_results_msg
        return no_results_msg

    # Group tools by server
    tools_by_server = {}
    for tool in tools:
        server = tool.get("server", "unknown")
        if server not in tools_by_server:
            tools_by_server[server] = []
        tools_by_server[server].append(tool)

    # Build tree structure
    lines = []

    # Add meta information at the top if available
    if meta_lines:
        lines.extend(meta_lines)
        lines.append("")  # Empty line before tree

    servers = sorted(tools_by_server.keys())

    for i, server in enumerate(servers):
        server_tools = tools_by_server[server]
        is_last_server = i == len(servers) - 1
        server_prefix = "└─" if is_last_server else "├─"

        # Use rich Text for colored output
        server_text = Text(f"{server_prefix} ")
        server_text.append(server, style="cyan")
        server_text.append(f" ({len(server_tools)} tools)")
        lines.append(server_text)

        # Add tools under this server
        for j, tool in enumerate(server_tools):
            is_last_tool = j == len(server_tools) - 1
            indent = "  " if is_last_server else "│ "
            tool_prefix = "└─" if is_last_tool else "├─"

            # Tool name line
            tool_name = tool.get("name", "unknown")
            tool_text = Text(f"{indent}{tool_prefix} {tool_name}")
            lines.append(tool_text)

            # Description on new line, aligned with tool name
            if tool.get("description"):
                # Calculate indent for description lines
                # Use the same base indent as the tool, then add alignment
                # If not the last tool, add vertical bar to show continuation, otherwise spaces
                desc_align = "   " if is_last_tool else "│  "
                description_indent = indent + desc_align
                description = tool["description"]

                # Get terminal width for wrapping (default to 120 if not available)
                try:
                    terminal_width = console.width
                except Exception:
                    terminal_width = 120

                # Calculate available width for description
                # Account for: indent + Panel padding (approximately 4 chars for borders/padding)
                indent_length = len(description_indent)
                available_width = max(40, terminal_width - indent_length - 4)

                # Wrap description text at word boundaries
                wrapped_lines = textwrap.wrap(
                    description,
                    width=available_width,
                    break_long_words=False,
                    break_on_hyphens=False
                )

                # Add indent to each line (including continuation lines)
                for desc_line in wrapped_lines:
                    desc_text = Text(description_indent)
                    desc_text.append(desc_line, style="dim")
                    lines.append(desc_text)

    # Convert to string for display
    result_lines = []
    for line in lines:
        if isinstance(line, Text):
            result_lines.append(line.plain)
        else:
            result_lines.append(str(line))

    return "\n".join(result_lines)


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
                # Special handling for search_tools to display as tree
                if tool_name == "search_tools":
                    # Get query from tool input
                    query = tool_input.get("query") if isinstance(tool_input, dict) else None

                    # Handle new format: object with meta and results
                    if isinstance(parsed_json, dict) and "results" in parsed_json:
                        results = parsed_json["results"]
                        meta = parsed_json.get("meta")
                        if isinstance(results, list):
                            tree_str = _format_search_tools_as_tree(results, meta, query)
                            console.print(
                                Panel(
                                    Markdown(f"```\n{tree_str}\n```", code_theme=CODE_THEME),
                                    title="[dim]Result[/dim]",
                                    border_style="dim white",
                                    padding=(0, 1),
                                )
                            )
                            return
                    # Handle old format: direct array (backward compatibility)
                    elif isinstance(parsed_json, list):
                        query = tool_input.get("query") if isinstance(tool_input, dict) else None
                        tree_str = _format_search_tools_as_tree(parsed_json, None, query)
                        console.print(
                            Panel(
                                Markdown(f"```\n{tree_str}\n```", code_theme=CODE_THEME),
                                title="[dim]Result[/dim]",
                                border_style="dim white",
                                padding=(0, 1),
                            )
                        )
                        return

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

                # Special handling for search_tools to display as tree
                if tool_name == "search_tools":
                    # Try to get query from event data input
                    event_input = event_data.get("input", {}) if event_data else {}
                    query = event_input.get("query") if isinstance(event_input, dict) else None

                    # Handle new format: object with meta and results
                    if isinstance(parsed_json, dict) and "results" in parsed_json:
                        results = parsed_json["results"]
                        meta = parsed_json.get("meta")
                        if isinstance(results, list):
                            tree_str = _format_search_tools_as_tree(results, meta, query)
                            console.print(
                                Panel(
                                    Markdown(f"```\n{tree_str}\n```", code_theme=CODE_THEME),
                                    title="[dim]Result[/dim]",
                                    border_style="dim white",
                                    padding=(0, 1),
                                )
                            )
                            return
                    # Handle old format: direct array (backward compatibility)
                    elif isinstance(parsed_json, list):
                        tree_str = _format_search_tools_as_tree(parsed_json, None, query)
                        console.print(
                            Panel(
                                Markdown(f"```\n{tree_str}\n```", code_theme=CODE_THEME),
                                title="[dim]Result[/dim]",
                                border_style="dim white",
                                padding=(0, 1),
                            )
                        )
                        return

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
