"""Regression tests for the remote agent's streamed response handling."""

import json

import pytest
from pydantic import BaseModel

from mcp_use.agents.remote import RemoteAgent


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("events", "expected"),
    [
        (["0:" + json.dumps("The answer "), "0:" + json.dumps("is 42."), "d:{}"], "The answer is 42."),
        (
            [
                "0:" + json.dumps("Let me check."),
                "9:{}",
                "0:" + json.dumps("The answer is 42."),
                "d:{}",
            ],
            "The answer is 42.",
        ),
        (
            [
                "0:" + json.dumps("First check."),
                "9:{}",
                "0:" + json.dumps("Second check."),
                "9:{}",
                "0:" + json.dumps("Done."),
                "d:{}",
            ],
            "Done.",
        ),
    ],
)
async def test_run_returns_final_turn_text(events: list[str], expected: str) -> None:
    agent = RemoteAgent(agent_id="test", api_key="test")

    async def stream(*args: object, **kwargs: object):
        for event in events:
            yield event

    agent.stream = stream  # type: ignore[method-assign]
    try:
        assert await agent.run("question") == expected
    finally:
        await agent.close()


@pytest.mark.asyncio
async def test_run_keeps_structured_final_result_after_tool_call() -> None:
    class Answer(BaseModel):
        answer: str

    agent = RemoteAgent(agent_id="test", api_key="test")

    async def stream(*args: object, **kwargs: object):
        yield "0:" + json.dumps("Let me check.")
        yield "9:{}"
        yield "f:" + json.dumps({"answer": "42"})
        yield "d:{}"

    agent.stream = stream  # type: ignore[method-assign]
    try:
        assert await agent.run("question", output_schema=Answer) == Answer(answer="42")
    finally:
        await agent.close()
