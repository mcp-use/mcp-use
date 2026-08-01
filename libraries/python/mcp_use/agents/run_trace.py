"""Run trace models for inspecting MCP agent tool use."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any


def _json_safe(value: Any) -> Any:
    """Return a value that can be written to JSON without losing nested shape."""
    try:
        json.dumps(value)
        return value
    except TypeError:
        if isinstance(value, dict):
            return {str(key): _json_safe(item) for key, item in value.items()}
        if isinstance(value, list | tuple):
            return [_json_safe(item) for item in value]
        return str(value)


def _preview(value: Any, max_chars: int) -> str:
    """Convert a potentially structured value into a bounded text preview."""
    safe_value = _json_safe(value)
    if isinstance(safe_value, str):
        text = safe_value
    else:
        text = json.dumps(safe_value, ensure_ascii=False, sort_keys=True)
    if len(text) <= max_chars:
        return text
    return f"{text[: max_chars - 12]}...<truncated>"


@dataclass
class ToolCallRecord:
    """A single tool call observed during an agent run."""

    index: int
    tool: str
    tool_call_id: str | None
    input: Any
    log: str = ""
    started_at: float = field(default_factory=time.time)
    completed_at: float | None = None
    output: Any = None
    output_preview: str | None = None
    error: str | None = None

    @property
    def latency_ms(self) -> int | None:
        """Return elapsed time for a completed tool call."""
        if self.completed_at is None:
            return None
        return int((self.completed_at - self.started_at) * 1000)

    def complete(self, output: Any, *, max_output_chars: int) -> None:
        """Attach the tool result to this record."""
        self.completed_at = time.time()
        self.output = _json_safe(output)
        self.output_preview = _preview(output, max_output_chars)

    def fail(self, error: str) -> None:
        """Mark the tool call as failed before a matching ToolMessage was emitted."""
        self.completed_at = time.time()
        self.error = error

    def as_dict(self) -> dict[str, Any]:
        """Return a JSON-serializable representation of this tool call."""
        return {
            "index": self.index,
            "tool": self.tool,
            "tool_call_id": self.tool_call_id,
            "input": _json_safe(self.input),
            "log": self.log,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "latency_ms": self.latency_ms,
            "output": self.output,
            "output_preview": self.output_preview,
            "error": self.error,
        }


@dataclass
class AgentRunTrace:
    """Inspectable trace for the most recent MCPAgent run."""

    query: str
    max_output_chars: int = 4000
    started_at: float = field(default_factory=time.time)
    completed_at: float | None = None
    final_output: str | None = None
    error: str | None = None
    tool_calls: list[ToolCallRecord] = field(default_factory=list)
    _pending_by_id: dict[str, ToolCallRecord] = field(default_factory=dict, repr=False)

    @property
    def duration_ms(self) -> int | None:
        """Return elapsed time for a completed run."""
        if self.completed_at is None:
            return None
        return int((self.completed_at - self.started_at) * 1000)

    @property
    def tool_call_count(self) -> int:
        """Return the number of tool calls observed in this run."""
        return len(self.tool_calls)

    def record_tool_call(self, *, tool: str, tool_call_id: str | None, tool_input: Any, log: str = "") -> None:
        """Record a tool request emitted by the model."""
        record = ToolCallRecord(
            index=len(self.tool_calls),
            tool=tool,
            tool_call_id=tool_call_id,
            input=_json_safe(tool_input),
            log=log,
        )
        self.tool_calls.append(record)
        if tool_call_id:
            self._pending_by_id[tool_call_id] = record

    def record_tool_result(self, *, tool_call_id: str | None, output: Any) -> None:
        """Attach a tool result to the matching pending call when possible."""
        record = self._pending_by_id.pop(tool_call_id, None) if tool_call_id else None
        if record is None:
            record = ToolCallRecord(
                index=len(self.tool_calls),
                tool="unknown",
                tool_call_id=tool_call_id,
                input={},
            )
            self.tool_calls.append(record)
        record.complete(output, max_output_chars=self.max_output_chars)

    def complete(self, final_output: str | None = None, error: str | None = None) -> None:
        """Mark the run as complete and close any unmatched tool calls."""
        self.completed_at = time.time()
        self.final_output = final_output
        self.error = error
        for record in self._pending_by_id.values():
            record.fail("No matching ToolMessage was emitted before the run completed")
        self._pending_by_id.clear()

    def tool_counts(self) -> dict[str, int]:
        """Return per-tool usage counts for this run."""
        counts: dict[str, int] = {}
        for record in self.tool_calls:
            counts[record.tool] = counts.get(record.tool, 0) + 1
        return counts

    def outputs_by_tool(self) -> dict[str, list[Any]]:
        """Return tool outputs grouped by tool name."""
        outputs: dict[str, list[Any]] = {}
        for record in self.tool_calls:
            outputs.setdefault(record.tool, []).append(record.output)
        return outputs

    def as_dict(self) -> dict[str, Any]:
        """Return a JSON-serializable trace."""
        return {
            "query": self.query,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "duration_ms": self.duration_ms,
            "tool_call_count": self.tool_call_count,
            "tool_counts": self.tool_counts(),
            "final_output": self.final_output,
            "error": self.error,
            "tool_calls": [record.as_dict() for record in self.tool_calls],
        }
