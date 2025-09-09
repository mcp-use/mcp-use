import json
from enum import Enum
from typing import TypeVar

from pydantic import BaseModel, Field, field_validator

# Type variable for structured output
T = TypeVar("T", bound=BaseModel)


class StepType(str, Enum):
    """Type of step in the ReAct loop."""

    THOUGHT = "thought"
    ACTION = "action"
    OBSERVATION = "observation"
    FINAL_ANSWER = "final_answer"


class ReActStep(BaseModel):
    """Represents a single step in the ReAct reasoning loop."""

    step_type: StepType
    thought: str | None = None
    action: str | None = None
    action_input: dict | None = None
    observation: str | None = None
    final_answer: str | None = None
    raw_output: str | None = None

    # Normalize action_input to always be a dict - handles LLM outputs that may be
    # JSON strings, plain text, or already structured data
    @field_validator("action_input", mode="before")
    @classmethod
    def parse_action_input(cls, v):
        """Parse action input from string to dict if needed."""
        if isinstance(v, str):
            try:
                # Try to parse as JSON
                return json.loads(v)
            except json.JSONDecodeError:
                # If not valid JSON, wrap in a dict
                return {"input": v}
        return v


class ReActResponse(BaseModel):
    """Structured response from the LLM for ReAct reasoning."""

    thought: str = Field(..., description="Your reasoning about what to do next")
    action: str | None = Field(None, description="The action/tool to execute, or None if providing final answer")
    action_input: dict | None = Field(None, description="Input parameters for the action as a dictionary")
    final_answer: str | None = Field(None, description="The final answer if you have enough information")

    @field_validator("action_input", mode="before")
    @classmethod
    def parse_action_input(cls, v):
        """Parse action input from string to dict if needed."""
        if v is None:
            return None
        if isinstance(v, str):
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return {"input": v}
        return v


class Message(BaseModel):
    """Represents a message in conversation history."""

    role: str
    content: str


class ConversationMemory:
    """Manages conversation history for the ReAct agent."""

    def __init__(self, max_turns: int | None = None):
        """Initialize conversation memory.

        Args:
            max_turns: Maximum number of conversation turns to keep.
        """
        self.messages: list[Message] = []
        self.max_turns = max_turns

    def add_message(self, role: str, content: str) -> None:
        """Add a message to the conversation history."""
        self.messages.append(Message(role=role, content=content))

        # Trim history if max_turns is set
        # Keep only the last max_turns * 2 messages
        # "turn" in a conversation typically consists of two messages: user and assistant
        if self.max_turns and len(self.messages) > self.max_turns * 2:
            # Keep system message if it exists
            system_msgs = [m for m in self.messages if m.role == "system"]
            other_msgs = [m for m in self.messages if m.role != "system"]
            # Keep only the last max_turns * 2 messages
            self.messages = system_msgs + other_msgs[-(self.max_turns * 2) :]

    def get_messages(self) -> list[dict[str, str]]:
        """Get messages formatted for LLM."""
        # Convert a Pydantic model to a dictionary
        return [msg.model_dump() for msg in self.messages]

    def clear(self) -> None:
        """Clear conversation history."""
        # Keep system message if it exists
        system_msgs = [m for m in self.messages if m.role == "system"]
        self.messages = system_msgs

    def get_formatted_history(self) -> str:
        """Get formatted conversation history as a string."""
        formatted = []
        for msg in self.messages:
            if msg.role != "system":
                formatted.append(f"{msg.role.upper()}: {msg.content}")
        return "\n".join(formatted)
