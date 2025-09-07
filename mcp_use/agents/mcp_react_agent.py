"""
MCP ReAct Agent: A ReAct (Reasoning and Acting) agent implementation without LangChain.

This module provides a ReAct agent that integrates with MCP tools using the instructor
library for structured LLM outputs and Pydantic for data models.
"""

import json
import time
from collections.abc import AsyncGenerator
from enum import Enum
from typing import Any, TypeVar

from pydantic import BaseModel, Field, field_validator

from mcp_use.client import MCPClient
from mcp_use.connectors.base import BaseConnector
from mcp_use.llm import LLMClient
from mcp_use.logging import logger
from mcp_use.telemetry.telemetry import Telemetry

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


class MCPToolAdapter:
    """Adapts MCP tools for use in the ReAct agent."""

    def __init__(self, client: MCPClient | None = None, connectors: list[BaseConnector] | None = None):
        """Initialize the MCP tool adapter.

        Args:
            client: Optional MCPClient instance.
            connectors: Optional list of MCP connectors.
        """
        self.client = client
        self.connectors = connectors or []
        self.tools: dict[str, Any] = {}
        self._initialized = False

    async def initialize(self) -> None:
        """Initialize and discover available tools."""
        if self._initialized:
            return

        logger.info("Discovering MCP tools...")

        if self.client:
            # Get tools from client
            sessions = self.client.get_all_active_sessions()
            if not sessions:
                sessions = await self.client.create_all_sessions()

            for _session_id, session in sessions.items():
                tools = await session.list_tools()
                for tool in tools:
                    tool_name = tool.name
                    self.tools[tool_name] = {
                        "session": session,
                        "schema": tool.inputSchema if hasattr(tool, "inputSchema") else {},
                        "description": tool.description if hasattr(tool, "description") else "",
                    }
                    logger.debug(f"Discovered tool: {tool_name}")

        elif self.connectors:
            # Get tools from direct connectors
            for connector in self.connectors:
                if not hasattr(connector, "client_session") or connector.client_session is None:
                    await connector.connect()

                # Initialize the session
                session = connector.client_session
                await session.initialize()

                tools = await session.list_tools()
                for tool in tools:
                    tool_name = tool.name
                    self.tools[tool_name] = {
                        "session": session,
                        "schema": tool.inputSchema if hasattr(tool, "inputSchema") else {},
                        "description": tool.description if hasattr(tool, "description") else "",
                    }
                    logger.debug(f"Discovered tool: {tool_name}")

        self._initialized = True
        logger.info(f"Discovered {len(self.tools)} tools")

    async def execute_tool(self, name: str, params: dict | None = None) -> str:
        """Execute a tool and return the result.

        Args:
            name: Tool name.
            params: Tool parameters.

        Returns:
            Tool execution result as a string.
        """
        if name not in self.tools:
            return f"Error: Tool '{name}' not found. Available tools: {', '.join(self.tools.keys())}"

        try:
            tool_info = self.tools[name]
            session = tool_info["session"]

            # Execute the tool
            result = await session.call_tool(name, arguments=params or {})

            # Format the result
            if hasattr(result, "content"):
                # Handle different content types
                content = result.content
                if isinstance(content, list):
                    # Join multiple content items
                    formatted_parts = []
                    for item in content:
                        if hasattr(item, "text"):
                            formatted_parts.append(item.text)
                        elif hasattr(item, "type") and item.type == "text":
                            formatted_parts.append(item.text)
                        else:
                            formatted_parts.append(str(item))
                    return "\n".join(formatted_parts)
                elif hasattr(content, "text"):
                    return content.text
                else:
                    return str(content)
            else:
                return str(result)

        except Exception as e:
            logger.error(f"Error executing tool {name}: {e}")
            return f"Error executing tool '{name}': {str(e)}"

    def get_tool_descriptions(self) -> str:
        """Get formatted descriptions of all available tools."""
        if not self.tools:
            return "No tools available."

        descriptions = []
        for name, info in self.tools.items():
            desc = f"- {name}: {info['description']}"
            if info.get("schema"):
                desc += f"\n  Parameters: {json.dumps(info['schema'], indent=2)}"
            descriptions.append(desc)

        return "\n".join(descriptions)

    def get_tool_names(self) -> list[str]:
        """Get list of available tool names."""
        return list(self.tools.keys())


class ReActExecutor:
    """Core execution engine for the ReAct loop."""

    def __init__(
        self,
        llm_client: Any,
        tool_adapter: MCPToolAdapter,
        max_steps: int = 5,
        verbose: bool = False,
    ):
        """Initialize the ReAct executor.

        Args:
            llm_client: Instructor-wrapped LLM client.
            tool_adapter: MCP tool adapter.
            max_steps: Maximum number of reasoning steps.
            verbose: Whether to print detailed logs.
        """
        self.llm_client = llm_client
        self.tool_adapter = tool_adapter
        self.max_steps = max_steps
        self.verbose = verbose
        self.steps: list[ReActStep] = []

    def _build_prompt(self, query: str, steps: list[ReActStep]) -> str:
        """Build the prompt for the next reasoning step.

        Args:
            query: The user query.
            steps: Previous reasoning steps.

        Returns:
            Formatted prompt string.
        """
        prompt_parts = [f"Question: {query}"]

        # Add previous steps
        for i, step in enumerate(steps, 1):
            if step.thought:
                prompt_parts.append(f"Thought {i}: {step.thought}")
            if step.action and step.action_input is not None:
                prompt_parts.append(f"Action {i}: {step.action}")
                prompt_parts.append(f"Action Input {i}: {json.dumps(step.action_input)}")
            if step.observation:
                prompt_parts.append(f"Observation {i}: {step.observation}")

        # Add instruction for next step
        next_num = len(steps) + 1
        if steps and steps[-1].observation:
            prompt_parts.append(
                f"\nBased on the observation above, continue reasoning. "
                f"If you have enough information, provide the final answer. "
                f"Otherwise, think about what to do next (Thought {next_num})."
            )
        else:
            prompt_parts.append(f"\nNow, provide Thought {next_num} about what to do next.")

        return "\n".join(prompt_parts)

    async def execute(self, query: str, memory: ConversationMemory | None = None) -> str:
        """Execute the ReAct loop for a query.

        Args:
            query: The user query.
            memory: Optional conversation memory.

        Returns:
            The final answer.
        """
        self.steps = []

        for step_num in range(self.max_steps):
            if self.verbose:
                logger.info(f"Step {step_num + 1}/{self.max_steps}")

            # Build prompt with previous steps
            prompt = self._build_prompt(query, self.steps)

            # Get structured response from LLM
            messages = []
            if memory:
                messages = memory.get_messages()
                # Add current prompt as user message
                messages.append({"role": "user", "content": prompt})
            else:
                messages = [{"role": "user", "content": prompt}]

            try:
                response: ReActResponse = await self.llm_client.chat.completions.create(
                    model=self.llm_client.model_name,
                    response_model=ReActResponse,
                    messages=messages,
                )

                # Create a step from the response
                step = ReActStep(
                    step_type=StepType.THOUGHT,
                    thought=response.thought,
                    action=response.action,
                    action_input=response.action_input,
                    final_answer=response.final_answer,
                )

                if self.verbose:
                    logger.info(f"Thought: {response.thought}")

                # Check if we have a final answer
                if response.final_answer:
                    step.step_type = StepType.FINAL_ANSWER
                    self.steps.append(step)
                    if self.verbose:
                        logger.info(f"Final Answer: {response.final_answer}")
                    return response.final_answer

                # Execute action if provided
                if response.action:
                    step.step_type = StepType.ACTION
                    if self.verbose:
                        logger.info(f"Action: {response.action}")
                        logger.info(f"Action Input: {response.action_input}")

                    # Execute the tool
                    observation = await self.tool_adapter.execute_tool(response.action, response.action_input)
                    step.observation = observation

                    if self.verbose:
                        if len(observation) > 200:
                            logger.info(f"Observation: {observation[:200]}...")
                        else:
                            logger.info(f"Observation: {observation}")

                self.steps.append(step)

            except Exception as e:
                logger.error(f"Error in ReAct step: {e}")
                error_step = ReActStep(
                    step_type=StepType.OBSERVATION,
                    observation=f"Error: {str(e)}",
                )
                self.steps.append(error_step)

        # If we've exhausted max steps, return the last observation or a message
        if self.steps:
            last_step = self.steps[-1]
            if last_step.observation:
                return last_step.observation
            elif last_step.thought:
                return f"Reasoning incomplete after {self.max_steps} steps. Last thought: {last_step.thought}"

        return f"Could not complete reasoning within {self.max_steps} steps."

    async def stream_execute(
        self, query: str, memory: ConversationMemory | None = None
    ) -> AsyncGenerator[tuple[StepType, str], None]:
        """Execute the ReAct loop with streaming output.

        Args:
            query: The user query.
            memory: Optional conversation memory.

        Yields:
            Tuples of (step_type, content) for each step.
        """
        self.steps = []

        for _step_num in range(self.max_steps):
            # Build prompt with previous steps
            prompt = self._build_prompt(query, self.steps)

            # Get structured response from LLM
            messages = []
            if memory:
                messages = memory.get_messages()
                messages.append({"role": "user", "content": prompt})
            else:
                messages = [{"role": "user", "content": prompt}]

            try:
                response: ReActResponse = await self.llm_client.chat.completions.create(
                    model=self.llm_client.model_name,
                    response_model=ReActResponse,
                    messages=messages,
                )

                # Yield thought
                if response.thought:
                    yield (StepType.THOUGHT, response.thought)

                # Check if we have a final answer
                if response.final_answer:
                    yield (StepType.FINAL_ANSWER, response.final_answer)
                    return

                # Execute action if provided
                if response.action:
                    yield (StepType.ACTION, f"{response.action} with {json.dumps(response.action_input)}")

                    # Execute the tool
                    observation = await self.tool_adapter.execute_tool(response.action, response.action_input)
                    yield (StepType.OBSERVATION, observation)

                    # Create step for history
                    step = ReActStep(
                        step_type=StepType.ACTION,
                        thought=response.thought,
                        action=response.action,
                        action_input=response.action_input,
                        observation=observation,
                    )
                    self.steps.append(step)
                else:
                    # Just a thought step
                    step = ReActStep(
                        step_type=StepType.THOUGHT,
                        thought=response.thought,
                    )
                    self.steps.append(step)

            except Exception as e:
                logger.error(f"Error in ReAct streaming step: {e}")
                yield (StepType.OBSERVATION, f"Error: {str(e)}")


class MCPReActAgent:
    """ReAct agent implementation without LangChain, compatible with MCPAgent interface."""

    def __init__(
        self,
        model_name: str,
        model_api_key: str | None = None,
        client: MCPClient | None = None,
        connectors: list[BaseConnector] | None = None,
        max_steps: int = 5,
        auto_initialize: bool = False,
        memory_enabled: bool = True,
        system_prompt: str | None = None,
        verbose: bool = False,
    ):
        """Initialize the ReAct agent.

        Args:
            model_name: Model name (e.g., "gpt-4", "claude-3-sonnet") or
                       provider/model format (e.g., "openai/gpt-4").
            model_api_key: API key for the LLM provider.
            client: Optional MCPClient instance.
            connectors: Optional list of MCP connectors.
            max_steps: Maximum number of reasoning steps.
            auto_initialize: Whether to auto-initialize on first run.
            memory_enabled: Whether to maintain conversation history.
            system_prompt: Optional custom system prompt.
            verbose: Whether to print detailed logs.
        """
        self.client = client
        self.connectors = connectors or []
        self.max_steps = max_steps
        self.auto_initialize = auto_initialize
        self.memory_enabled = memory_enabled
        self.verbose = verbose
        self._initialized = False

        # Set up LLM client with instructor using the new LLMClient class
        self.llm_client = LLMClient(
            model_name=model_name,
            api_key=model_api_key,
            use_async=True,  # Always use async clients (do not change this)
        )
        self.model_name = model_name

        # Initialize components
        self.tool_adapter = MCPToolAdapter(client=client, connectors=connectors)
        self.executor = ReActExecutor(
            llm_client=self.llm_client,
            tool_adapter=self.tool_adapter,
            max_steps=max_steps,
            verbose=verbose,
        )

        # Memory management
        self.memory = ConversationMemory(max_turns=max_steps) if memory_enabled else None

        # System prompt
        self.system_prompt = system_prompt or self._get_default_system_prompt()

        # Telemetry
        self.telemetry = Telemetry()
        self._model_provider = self.llm_client.model_name.split("/")[0] or "unknown"
        self._model_name = self.llm_client.model_name.split("/")[1] or "unknown"

    def _get_default_system_prompt(self) -> str:
        """Get the default ReAct system prompt."""
        return """You are a helpful assistant that uses the ReAct (Reasoning and Acting) framework to solve problems.

Follow this approach:
1. Thought: Reason about what you need to do
2. Action: Choose an action to take from available tools
3. Observation: Observe the result
4. Repeat until you have enough information
5. Provide a final answer

Always start with a thought about the problem. Be systematic and thorough in your reasoning.
When you have sufficient information, provide a clear and complete final answer."""

    async def initialize(self) -> None:
        """Initialize the agent and discover tools."""
        if self._initialized:
            return

        logger.info("Initializing ReAct agent...")

        # Initialize tool adapter
        await self.tool_adapter.initialize()

        # Build system prompt with tool descriptions
        tool_descriptions = self.tool_adapter.get_tool_descriptions()
        tool_names = self.tool_adapter.get_tool_names()

        full_system_prompt = f"""{self.system_prompt}

Available tools:
{tool_descriptions}

When taking an action, use one of these tool names: {", ".join(tool_names)}

Remember:
- Always think before acting
- Use tools to gather information
- Provide clear observations after each action
- Give a final answer when you have enough information"""

        # Add system prompt to memory if enabled
        if self.memory:
            self.memory.add_message("system", full_system_prompt)

        self._initialized = True
        logger.info(f"ReAct agent initialized with {len(self.tool_adapter.tools)} tools")

    async def run(
        self,
        query: str,
        max_steps: int | None = None,
        manage_connector: bool = True,
        output_schema: type[T] | None = None,
    ) -> str | T:
        """Run a query and return the result.

        Args:
            query: The user query.
            max_steps: Optional override for max steps.
            manage_connector: Whether to manage connector lifecycle.
            output_schema: Optional Pydantic model for structured output.

        Returns:
            Query result as string or structured output.
        """
        # Auto-initialize if needed
        if not self._initialized and self.auto_initialize:
            await self.initialize()
        elif not self._initialized:
            raise RuntimeError("Agent not initialized. Call initialize() first.")

        # Override max steps if provided
        if max_steps:
            self.executor.max_steps = max_steps

        # Track execution
        start_time = time.time()
        success = True
        result = ""

        try:
            # Add query to memory
            if self.memory:
                self.memory.add_message("user", query)

            # Execute the ReAct loop
            result = await self.executor.execute(query, self.memory)

            # Add response to memory
            if self.memory:
                self.memory.add_message("assistant", result)

            # Handle structured output if requested
            if output_schema:
                # Use instructor to parse the result into the schema
                structured_result = await self.llm_client.chat.completions.create(
                    model=self.model_name,
                    response_model=output_schema,
                    messages=[
                        {"role": "system", "content": "Extract the requested information from the provided text."},
                        {"role": "user", "content": result},
                    ],
                )
                return structured_result

            return result

        except Exception as e:
            success = False
            logger.error(f"Error during execution: {e}")
            raise
        finally:
            # Track telemetry
            execution_time_ms = int((time.time() - start_time) * 1000)
            self.telemetry.track_agent_execution(
                execution_method="run",
                query=query,
                success=success,
                model_provider=self._model_provider,
                model_name=self._model_name,
                server_count=len(self.client.get_all_active_sessions()) if self.client else len(self.connectors),
                server_identifiers=[connector.public_identifier for connector in self.connectors],
                total_tools_available=len(self.tool_adapter.tools),
                tools_available_names=list(self.tool_adapter.tools.keys()),
                max_steps_configured=self.max_steps,
                memory_enabled=self.memory_enabled,
                use_server_manager=False,
                max_steps_used=max_steps,
                manage_connector=manage_connector,
                external_history_used=False,
                steps_taken=len(self.executor.steps),
                tools_used_count=sum(1 for s in self.executor.steps if s.action),
                tools_used_names=[s.action for s in self.executor.steps if s.action],
                response=str(result)[:1000],  # Truncate for telemetry
                execution_time_ms=execution_time_ms,
                error_type=None if success else "execution_error",
                conversation_history_length=len(self.memory.messages) if self.memory else 0,
            )

    async def stream(
        self,
        query: str,
        max_steps: int | None = None,
        manage_connector: bool = True,
    ) -> AsyncGenerator[tuple[StepType, str], None]:
        """Stream the ReAct execution steps.

        Args:
            query: The user query.
            max_steps: Optional override for max steps.
            manage_connector: Whether to manage connector lifecycle.

        Yields:
            Tuples of (step_type, content) for each step.
        """
        # Auto-initialize if needed
        if not self._initialized and self.auto_initialize:
            await self.initialize()
        elif not self._initialized:
            raise RuntimeError("Agent not initialized. Call initialize() first.")

        # Override max steps if provided
        if max_steps:
            self.executor.max_steps = max_steps

        # Add query to memory
        if self.memory:
            self.memory.add_message("user", query)

        # Stream the execution
        final_answer = ""
        async for step_type, content in self.executor.stream_execute(query, self.memory):
            if step_type == StepType.FINAL_ANSWER:
                final_answer = content
            yield (step_type, content)

        # Add final answer to memory
        if self.memory and final_answer:
            self.memory.add_message("assistant", final_answer)

    async def close(self) -> None:
        """Close the agent and clean up resources."""
        logger.info("Closing ReAct agent...")

        # Close client sessions
        if self.client:
            await self.client.close_all_sessions()
        elif self.connectors:
            for connector in self.connectors:
                await connector.disconnect()

        # Clear memory
        if self.memory:
            self.memory.clear()

        self._initialized = False
        logger.info("ReAct agent closed")

    def get_conversation_history(self) -> list[Message]:
        """Get the conversation history."""
        if self.memory:
            return self.memory.messages
        return []

    def clear_conversation_history(self) -> None:
        """Clear the conversation history."""
        if self.memory:
            self.memory.clear()

    def add_to_history(self, role: str, content: str) -> None:
        """Add a message to the conversation history."""
        if self.memory:
            self.memory.add_message(role, content)
