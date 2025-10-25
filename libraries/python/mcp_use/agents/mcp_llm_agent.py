"""
MCP LLM Agent implementation using the new LLM engine.

This module provides the MCPLLMAgent class that replaces the LangChain-based
MCPAgent with a cleaner implementation using the new LLM provider.
"""

import json
import time
from collections.abc import AsyncGenerator
from typing import TypeVar

from litellm import ChatCompletionMessageToolCall
from litellm.types.utils import ModelResponseStream
from pydantic import BaseModel

from mcp_use.client import MCPClient
from mcp_use.llm.tools import Tool
from mcp_use.telemetry.telemetry import Telemetry

from ..adapters.llm_adapter import LLMAdapter
from ..llm import LLM, Message, ToolMessage
from ..logging import logger
from .prompts.system_prompt_builder import create_system_message
from .prompts.templates import DEFAULT_SYSTEM_PROMPT_TEMPLATE
from .remote import RemoteAgent

# Type variable for structured output
T = TypeVar("T", bound=BaseModel)


class MCPLLMAgent:
    """MCP Agent using the new LLM engine instead of LangChain.

    This class provides a unified interface for using MCP tools with different LLM providers
    through the new LLM engine, with customizable system prompts and conversation memory.
    """

    def __init__(
        self,
        name: str | None = None,
        additional_instructions: str | None = None,
        model: str | None = None,
        llm: LLM | None = None,
        client: MCPClient | None = None,
        max_steps: int = 5,
        memory_enabled: bool = True,
        system_prompt: str | None = None,
        verbose: bool = False,
        agent_id: str | None = None,
        api_key: str | None = None,
        base_url: str = "https://cloud.mcp-use.com",
        chat_id: str | None = None,
        retry_on_error: bool = True,
        max_retries_per_step: int = 2,
    ):
        """Initialize a new MCPLLMAgent instance.

        Args:
            name: The name of the agent.
            additional_instructions: Extra instructions to append to the system prompt.
            model: The model name to use (e.g. 'gpt-4o'). If provided, creates LLM automatically.
            llm: The LLM instance to use. If model is provided, this is ignored.
            client: The MCPClient to use. If provided, connector is ignored.
            max_steps: The maximum number of steps to take.
            memory_enabled: Whether to maintain conversation history for context.
            system_prompt: Complete system prompt to use (overrides template if provided).
            agent_id: Remote agent ID for remote execution. If provided, creates a remote agent.
            api_key: API key for remote execution. If None, checks MCP_USE_API_KEY env var.
            base_url: Base URL for remote API calls.
            retry_on_error: Whether to retry tool calls that fail due to validation errors.
            max_retries_per_step: Maximum number of retries for validation errors per step.
        """
        # Handle remote execution
        if agent_id is not None:
            self._remote_agent = RemoteAgent(agent_id=agent_id, api_key=api_key, base_url=base_url, chat_id=chat_id)
            self._is_remote = True
            return

        self._is_remote = False
        self._remote_agent = None

        # Set up LLM
        if llm is not None:
            self.llm = llm
        elif model is not None:
            self.llm = LLM(model)
        else:
            raise ValueError(
                """Either model or llm must be provided for local execution. For remote execution,
                provide agent_id instead."""
            )

        self.client = client
        self.max_steps = max_steps
        self.memory_enabled = memory_enabled
        self._initialized = False
        self._conversation_history: list[Message | ToolMessage] = []
        self.verbose = verbose
        self.retry_on_error = retry_on_error
        self.max_retries_per_step = max_retries_per_step

        # System prompt configuration
        self.system_prompt = system_prompt
        self.additional_instructions = additional_instructions

        # Either client or connector must be provided
        if not client:
            raise ValueError("Client must be provided")

        # Create the adapter for tool conversion
        self.adapter = LLMAdapter()

        # Initialize telemetry
        self.telemetry = Telemetry()

        # State tracking
        self._system_message: Message | None = None
        self._tools: list[Tool] = []

        # Track model info for telemetry
        self._model_provider, self._model_name = "custom", getattr(self.llm, "model", "unknown")

    async def initialize(self) -> None:
        """Initialize the MCP client and agent."""
        logger.info("🚀 Initializing MCP agent and connecting to services...")

        # Standard initialization - if using client, get or create sessions
        self._sessions = self.client.get_all_active_sessions()
        logger.info(f"🔌 Found {len(self._sessions)} existing sessions")

        # If no active sessions exist, create new ones
        if not self._sessions:
            logger.info("🔄 No active sessions found, creating new ones...")
            self._sessions = await self.client.create_all_sessions()
            self.connectors = [session.connector for session in self._sessions.values()]
            logger.info(f"✅ Created {len(self._sessions)} new sessions")

        # Create tools directly from the client using the adapter
        self._tools = await self.adapter.create_tools(self.client)
        logger.info(f"🛠️ Created {len(self._tools)} tools from client")
        logger.info(f"🧰 Found {len(self._tools)} tools across all connectors")

        # Create the system message based on available tools
        await self._create_system_message_from_tools(self._tools)

        self._initialized = True
        logger.info("✨ Agent initialization complete")

    async def _create_system_message_from_tools(self, tools: list) -> None:
        """Create the system message based on provided tools using the builder."""
        # Use the override if provided, otherwise use the imported default
        server_template = DEFAULT_SYSTEM_PROMPT_TEMPLATE
        # Delegate creation to the imported function
        system_message = create_system_message(
            tools=tools,
            system_prompt_template=server_template,
            server_manager_template=server_template,
            use_server_manager=False,
            disallowed_tools=[],
            user_provided_prompt=self.system_prompt,
            additional_instructions=self.additional_instructions,
        )

        # Convert to our Message format
        self._system_message = Message(role="system", content=system_message.content)

        # Update conversation history if memory is enabled
        if self.memory_enabled:
            history_without_system = [msg for msg in self._conversation_history if msg.role != "system"]
            self._conversation_history = [self._system_message] + history_without_system

    async def run(
        self,
        query: str,
        max_steps: int | None = None,
        external_history: list[Message | ToolMessage] | None = None,
        output_schema: type[T] | None = None,
    ) -> str | T:
        """Run a query using the MCP tools and return the final result.

        Args:
            query: The query to run.
            max_steps: Optional maximum number of steps to take.
            external_history: Optional external history to use instead of the internal conversation history.
            output_schema: Optional Pydantic BaseModel class for structured output.

        Returns:
            The result of running the query as a string, or if output_schema is provided,
            an instance of the specified Pydantic model.
        """
        generator = self.stream(query, max_steps, external_history, output_schema)
        return await self._consume_and_return(generator)

    async def stream(
        self,
        query: str,
        max_steps: int | None = None,
        external_history: list[Message | ToolMessage] | None = None,
        output_schema: type[T] | None = None,
    ) -> AsyncGenerator[ModelResponseStream, None]:
        """Run the agent and yield intermediate steps as an async generator.

        Args:
            query: The query to run.
            max_steps: Optional maximum number of steps to take.
            external_history: Optional external history to use instead of the internal conversation history.
            output_schema: Optional Pydantic BaseModel class for structured output.

        Yields:
            Intermediate steps as (action, observation) tuples, followed by the final result.
        """
        initialized_here = False
        start_time = time.time()
        try:
            if not self._initialized:
                await self.initialize()
                initialized_here = True

            if not self._initialized:
                raise RuntimeError("MCP LLM agent failed to initialize")

            steps = max_steps or self.max_steps
            display_query = query[:50].replace("\n", " ") + "..." if len(query) > 50 else query.replace("\n", " ")
            logger.info(f"💬 Received query: '{display_query}'")

            # Add the user query to conversation history if memory is enabled
            if self.memory_enabled:
                self._conversation_history.append(Message(role="user", content=query))

            # Use the provided history or the internal history
            history_to_use = external_history if external_history is not None else self._conversation_history
            current_messages = history_to_use.copy()

            logger.info(f"🏁 Starting agent execution with max_steps={steps}")

            for step_num in range(steps):
                logger.info(f"👣 Step {step_num + 1}/{steps}")
                try:
                    generator = self.llm.stream(messages=current_messages, tools=self._tools)
                    chunk: ModelResponseStream
                    async for chunk in generator:
                        yield chunk
                        assistant_message = chunk.choices[0].delta
                        print("-" * 100)
                        print(assistant_message)
                        print("-" * 100)
                        step_outputs = []

                        if assistant_message.tool_calls and False:
                            print("-" * 100)
                            print(assistant_message.tool_calls)
                            print("-" * 100)
                            async for output in self._handle_tool_calls(assistant_message.tool_calls, current_messages):
                                print("-" * 100)
                                print(output)
                                print("-" * 100)
                                step_outputs.append(output)

                            # yield assistant_message, step_outputs
                            # current_messages.append(assistant_message)

                        if step_outputs:
                            for output in step_outputs:
                                yield output
                        else:
                            result = assistant_message.content or "No response generated"
                            logger.info(f"✅ Agent finished at step {step_num + 1}")
                            break
                except Exception as e:
                    logger.error(f"❌ Error during agent execution step {step_num + 1}: {e}")
                    result = f"Agent stopped due to an error: {str(e)}"
                    break

            if not result:
                logger.warning(f"⚠️ Agent stopped after reaching max iterations ({steps})")
                result = f"Agent stopped after reaching the maximum number of steps ({steps})."

            if self.memory_enabled and not output_schema:
                history_without_system = [msg for msg in current_messages if msg.role != "system"]
                self._conversation_history = (
                    [self._system_message] + history_without_system if self._system_message else history_without_system
                )

            logger.info(f"🎉 Agent execution complete in {time.time() - start_time:.2f} seconds")

            if output_schema:
                try:
                    structured_result = output_schema.model_validate_json(result)
                    yield structured_result
                    return
                except Exception as e:
                    logger.error(f"❌ Failed to parse structured output: {e}")
                    raise RuntimeError(f"Failed to generate structured output: {str(e)}") from e

            yield result

        except Exception as e:
            logger.error(f"❌ Error running query: {e}")
            if initialized_here:
                logger.info("🧹 Cleaning up resources after initialization error in stream")
                await self.close()
            raise

    async def _handle_tool_calls(
        self, tool_calls: list[ChatCompletionMessageToolCall], current_messages: list[Message | ToolMessage]
    ) -> AsyncGenerator[tuple[str, str], None]:
        for tool_call in tool_calls:
            tool_name = tool_call.function.name
            tool_args = json.loads(tool_call.function.arguments)
            tool_found = False

            for tool in self._tools:
                if tool.name == tool_name:
                    tool_found = True
                    try:
                        print("-" * 100)
                        print(tool)
                        print("-" * 100)
                        tool_result = await tool(**tool_args)
                        tool_message = ToolMessage(
                            role="tool",
                            tool_call_id=tool_call.id,
                            content=str(tool_result),
                            name=tool_name,
                        )
                        current_messages.append(tool_message)
                        yield (f"Tool: {tool_name}", str(tool_result))
                        logger.info(f"🔧 Tool call: {tool_name} with input: {str(tool_args)[:100]}")
                        logger.info(f"📄 Tool result: {str(tool_result)[:100]}")
                    except Exception as e:
                        error_msg = f"Tool execution failed: {str(e)}"
                        tool_message = ToolMessage(
                            role="tool", tool_call_id=tool_call.id, content=error_msg, name=tool_name
                        )
                        current_messages.append(tool_message)
                        yield (f"Tool Error: {tool_name}", error_msg)
                        logger.error(f"❌ Tool execution failed: {e}")
                    break

            if not tool_found:
                error_msg = f"Tool '{tool_name}' not found"
                tool_message = ToolMessage(role="tool", tool_call_id=tool_call.id, content=error_msg, name=tool_name)
                current_messages.append(tool_message)
                yield ("Tool Error", error_msg)
                logger.error(f"❌ Tool not found: {tool_name}")

    async def close(self) -> None:
        """Close the MCP connection with improved error handling."""
        # Delegate to remote agent if in remote mode
        if self._is_remote and self._remote_agent:
            await self._remote_agent.close()
            return

        logger.info("🔌 Closing agent and cleaning up resources...")
        try:
            # Clean up the agent first
            self._tools = []

            # If using client with session, close the session through client
            if self.client:
                logger.info("🔄 Closing sessions through client")
                await self.client.close_all_sessions()
                if hasattr(self, "_sessions"):
                    self._sessions = {}
            # If using direct connector, disconnect
            elif self.connectors:
                for connector in self.connectors:
                    logger.info("🔄 Disconnecting connector")
                    await connector.disconnect()

            # Clear adapter tool cache
            if hasattr(self.adapter, "_connector_tool_map"):
                self.adapter._connector_tool_map = {}

            self._initialized = False
            logger.info("👋 Agent closed successfully")

        except Exception as e:
            logger.error(f"❌ Error during agent closure: {e}")
            # Still try to clean up references even if there was an error
            if hasattr(self, "_tools"):
                self._tools = []
            if hasattr(self, "_sessions"):
                self._sessions = {}
            self._initialized = False
