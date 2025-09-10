"""
MCP ReAct Agent: A ReAct (Reasoning and Acting) agent implementation without LangChain.

This module provides a ReAct agent that integrates with MCP tools using the instructor
library for structured LLM outputs and Pydantic for data models.
"""

import json
import time
from collections.abc import AsyncGenerator

from mcp_use.adapters.react_adapter import ReactAdapter
from mcp_use.adapters.types.react_adapter_types import ReactTool
from mcp_use.agents.prompts.templates import DEFAULT_REACT_SYSTEM_PROMPT_TEMPLATE
from mcp_use.agents.types.react_agent_types import ConversationMemory, Message, ReActResponse, ReActStep, StepType, T
from mcp_use.client import MCPClient
from mcp_use.connectors.base import BaseConnector
from mcp_use.llm import LLMClient
from mcp_use.logging import logger
from mcp_use.telemetry.telemetry import Telemetry


class ReActExecutor:
    """Core execution engine for the ReAct loop."""

    def __init__(
        self,
        llm_client: LLMClient,
        tools: dict[str, ReactTool],
        max_steps: int = 5,
        verbose: bool = False,
    ):
        """Initialize the ReAct executor.

        Args:
            llm_client: Instructor-wrapped LLM client.
            tools: Dictionary of available ReactTools.
            max_steps: Maximum number of reasoning steps.
            verbose: Whether to print detailed logs.
        """
        self.llm_client = llm_client
        self.tools = tools
        self.max_steps = max_steps
        self.verbose = verbose
        self.steps: list[ReActStep] = []

    async def _execute_tool(self, name: str, params: dict | None = None) -> str:
        """Execute a tool and return the result.

        Args:
            name: Tool name.
            params: Tool parameters.

        Returns:
            Tool execution result as a string.
        """
        logger.info(f"🛠️ Selected tool name: {name}")
        logger.info(f"🛠️ Selected tool: {self.tools.get(name)}")
        if not self.tools.get(name):
            return f"Error: Tool '{name}' not found. Available tools: {', '.join(self.tools.keys())}"

        try:
            tool = self.tools.get(name)
            logger.info(f"🛠️ Tool: {tool}")
            logger.info(f"🛠️ Tool execute: {tool.get('execute')}")
            return await tool["execute"](params)

        except Exception as e:
            logger.error(f"Error executing tool {name}: {e}")
            return f"Error executing tool '{name}': {str(e)}"

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

                logger.info(f"🛠️ Response: {response}")

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
                    observation = await self._execute_tool(response.action, response.action_input)
                    step.observation = observation

                    if self.verbose:
                        if len(observation) > 1000:
                            logger.info(f"Observation: {observation[:1000]}...")
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
                    observation = await self._execute_tool(response.action, response.action_input)
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
        disallowed_tools: list[str] | None = None,
        include_resources: bool = True,
        include_prompts: bool = True,
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
            disallowed_tools: List of tool names that should not be available.
            include_resources: Whether to include resources as tools.
            include_prompts: Whether to include prompts as tools.
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

        # Initialize adapter
        self.adapter = ReactAdapter(
            disallowed_tools=disallowed_tools,
            include_resources=include_resources,
            include_prompts=include_prompts,
        )

        # Tools dictionary will be populated during initialization
        self.tools: dict[str, ReactTool] = {}

        self._agent_executor: ReActExecutor | None = None

        # Memory management
        self.memory = ConversationMemory(max_turns=max_steps) if memory_enabled else None

        # System prompt
        self.system_prompt = system_prompt or DEFAULT_REACT_SYSTEM_PROMPT_TEMPLATE

        # Telemetry
        self.telemetry = Telemetry()
        self._model_provider = self.llm_client.provider.name
        self._model_name = self.llm_client.model_name or "unknown"

    async def initialize(self) -> None:
        """Initialize the agent and discover tools."""
        logger.info("Initializing ReAct agent...")

        # Use adapter to create tools
        if self.client:
            # Create tools from client
            tool_list = await self.adapter.create_tools(self.client)
            logger.info(f"🛠️ Created {len(tool_list)} ReAct tools from client")
        else:
            # Create tools from connectors
            tool_list = await self.adapter._create_tools_from_connectors(self.connectors)
            logger.info(f"🛠️ Created {len(tool_list)} ReAct tools from connectors")

        # Convert list of tool dicts to dictionary keyed by name
        self.tools = {tool["name"]: tool for tool in tool_list}

        # Create the agent
        self._agent_executor = self._create_agent()
        self._initialized = True
        logger.info("✨ Agent initialization complete")

    def _get_tool_descriptions(self) -> str:
        """Get formatted descriptions of all available tools."""
        if not self.tools:
            return "No tools available."

        descriptions = []
        for name, tool in self.tools.items():
            desc = f"- {name}: {tool['description']}"
            if tool["schema"]:
                desc += f"\n  Parameters: {json.dumps(tool['schema'], indent=2)}"
            descriptions.append(desc)

        return "\n".join(descriptions)

    def _create_agent(self) -> ReActExecutor:
        """Create the ReAct executor with the configured system message.

        Returns:
            An initialized ReAct executor.
        """

        tool_names = [tool["name"] for tool in self.tools.values()]
        logger.info(f"🧠 Agent ready with tools: {', '.join(tool_names)}")

        # Build system prompt with tool descriptions
        tool_descriptions = self._get_tool_descriptions()
        tool_names = list(self.tools.keys())

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

        agent = ReActExecutor(
            llm_client=self.llm_client,
            tools=self.tools,
            max_steps=self.max_steps,
            verbose=self.verbose,
        )
        logger.debug(f"Created ReAct executor with max_steps={self.max_steps} and {len(self.tools)} tools")
        return agent

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
            self._agent_executor.max_steps = max_steps

        # Track execution
        start_time = time.time()
        success = True
        result = ""

        try:
            # Add query to memory
            if self.memory:
                self.memory.add_message("user", query)

            # Execute the ReAct loop
            result = await self._agent_executor.execute(query, self.memory)

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
                total_tools_available=len(self.tools),
                tools_available_names=list(self.tools.keys()),
                max_steps_configured=self.max_steps,
                memory_enabled=self.memory_enabled,
                use_server_manager=False,
                max_steps_used=max_steps,
                manage_connector=manage_connector,
                external_history_used=False,
                steps_taken=len(self._agent_executor.steps),
                tools_used_count=sum(1 for s in self._agent_executor.steps if s.action),
                tools_used_names=[s.action for s in self._agent_executor.steps if s.action],
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
            self._agent_executor.max_steps = max_steps

        # Add query to memory
        if self.memory:
            self.memory.add_message("user", query)

        # Stream the execution
        final_answer = ""
        async for step_type, content in self._agent_executor.stream_execute(query, self.memory):
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

        # Clear tools
        self.tools.clear()

        # Clear adapter cache
        if hasattr(self.adapter, "_connector_tool_map"):
            self.adapter._connector_tool_map.clear()

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
