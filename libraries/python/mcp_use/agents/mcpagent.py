"""
MCP: Main integration module with customizable system prompt.

This module provides the main MCPAgent class that integrates all components
to provide a simple interface for using MCP tools with different LLMs.

LangChain 1.0.0 Migration:
- The agent uses create_agent() from langchain.agents which returns a CompiledStateGraph
- New methods: astream_simplified() and run_v2() leverage the built-in astream() from
  CompiledStateGraph which handles the agent loop internally
- Legacy methods: stream() and run() use manual step-by-step execution for backward compatibility
"""

import logging
import time
from collections.abc import AsyncGenerator, AsyncIterator
from typing import TypeVar

from langchain.agents import create_agent
from langchain.agents.middleware import ModelCallLimitMiddleware
from langchain_core.agents import AgentAction
from langchain_core.globals import set_debug
from langchain_core.language_models import BaseLanguageModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables.schema import StreamEvent
from langchain_core.tools import BaseTool
from pydantic import BaseModel

from mcp_use.agents.adapters.langchain_adapter import LangChainAdapter
from mcp_use.agents.managers.base import BaseServerManager
from mcp_use.agents.managers.server_manager import ServerManager

# Import observability manager
from mcp_use.agents.observability import ObservabilityManager
from mcp_use.agents.prompts.system_prompt_builder import create_system_message
from mcp_use.agents.prompts.templates import DEFAULT_SYSTEM_PROMPT_TEMPLATE, SERVER_MANAGER_SYSTEM_PROMPT_TEMPLATE
from mcp_use.agents.remote import RemoteAgent
from mcp_use.client import MCPClient
from mcp_use.client.connectors.base import BaseConnector
from mcp_use.logging import logger
from mcp_use.telemetry.telemetry import Telemetry, telemetry
from mcp_use.telemetry.utils import extract_model_info

set_debug(logger.level == logging.DEBUG)

# Type variable for structured output
T = TypeVar("T", bound=BaseModel)


class MCPAgent:
    """Main class for using MCP tools with various LLM providers.

    This class provides a unified interface for using MCP tools with different LLM providers
    through LangChain's agent framework, with customizable system prompts and conversation memory.
    """

    def __init__(
        self,
        llm: BaseLanguageModel | None = None,
        client: MCPClient | None = None,
        connectors: list[BaseConnector] | None = None,
        max_steps: int = 5,
        auto_initialize: bool = False,
        memory_enabled: bool = True,
        system_prompt: str | None = None,
        system_prompt_template: str | None = None,  # User can still override the template
        additional_instructions: str | None = None,
        disallowed_tools: list[str] | None = None,
        tools_used_names: list[str] | None = None,
        use_server_manager: bool = False,
        server_manager: BaseServerManager | None = None,
        verbose: bool = False,
        agent_id: str | None = None,
        api_key: str | None = None,
        base_url: str = "https://cloud.mcp-use.com",
        callbacks: list | None = None,
        chat_id: str | None = None,
        retry_on_error: bool = True,
        max_retries_per_step: int = 2,
    ):
        """Initialize a new MCPAgent instance.

        Args:
            llm: The LangChain LLM to use. Not required if agent_id is provided for remote execution.
            client: The MCPClient to use. If provided, connector is ignored.
            connectors: A list of MCP connectors to use if client is not provided.
            max_steps: The maximum number of steps to take.
            auto_initialize: Whether to automatically initialize the agent when run is called.
            memory_enabled: Whether to maintain conversation history for context.
            system_prompt: Complete system prompt to use (overrides template if provided).
            system_prompt_template: Template for system prompt with {tool_descriptions} placeholder.
            additional_instructions: Extra instructions to append to the system prompt.
            disallowed_tools: List of tool names that should not be available to the agent.
            use_server_manager: Whether to use server manager mode instead of exposing all tools.
            agent_id: Remote agent ID for remote execution. If provided, creates a remote agent.
            api_key: API key for remote execution. If None, checks MCP_USE_API_KEY env var.
            base_url: Base URL for remote API calls.
            callbacks: List of LangChain callbacks to use. If None and Langfuse is configured, uses langfuse_handler.
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

        # Validate requirements for local execution
        if llm is None:
            raise ValueError("llm is required for local execution. For remote execution, provide agent_id instead.")

        self.llm = llm
        self.client = client
        self.connectors = connectors or []
        self.max_steps = max_steps
        self.auto_initialize = auto_initialize
        self.memory_enabled = memory_enabled
        self._initialized = False
        self._conversation_history: list[BaseMessage] = []
        self.disallowed_tools = disallowed_tools or []
        self.tools_used_names = tools_used_names or []
        self.use_server_manager = use_server_manager
        self.server_manager = server_manager
        self.verbose = verbose
        self.retry_on_error = retry_on_error
        self.max_retries_per_step = max_retries_per_step
        # System prompt configuration
        self.system_prompt = system_prompt  # User-provided full prompt override
        # User can provide a template override, otherwise use the imported default
        self.system_prompt_template_override = system_prompt_template
        self.additional_instructions = additional_instructions

        # Set up observability callbacks using the ObservabilityManager
        self.observability_manager = ObservabilityManager(custom_callbacks=callbacks)
        self.callbacks = self.observability_manager.get_callbacks()

        # Either client or connector must be provided
        if not client and len(self.connectors) == 0:
            raise ValueError("Either client or connector must be provided")

        # Create the adapter for tool conversion
        self.adapter = LangChainAdapter(disallowed_tools=self.disallowed_tools)

        # Initialize telemetry
        self.telemetry = Telemetry()

        if self.use_server_manager and self.server_manager is None:
            if not self.client:
                raise ValueError("Client must be provided when using server manager")
            self.server_manager = ServerManager(self.client, self.adapter)

        # State tracking - initialize _tools as empty list
        self._agent_executor = None
        self._system_message: SystemMessage | None = None
        self._tools: list[BaseTool] = []

        # Track model info for telemetry
        self._model_provider, self._model_name = extract_model_info(self.llm)

    async def initialize(self) -> None:
        """Initialize the MCP client and agent."""
        logger.info("🚀 Initializing MCP agent and connecting to services...")
        # If using server manager, initialize it
        if self.use_server_manager and self.server_manager:
            await self.server_manager.initialize()
            # Get server management tools
            management_tools = self.server_manager.tools
            self._tools = management_tools
            logger.info(f"🔧 Server manager mode active with {len(management_tools)} management tools")

            # Create the system message based on available tools
            await self._create_system_message_from_tools(self._tools)
        else:
            # Standard initialization - if using client, get or create sessions
            if self.client:
                # First try to get existing sessions
                self._sessions = self.client.get_all_active_sessions()
                logger.info(f"🔌 Found {len(self._sessions)} existing sessions")

                # If no active sessions exist, create new ones
                if not self._sessions:
                    logger.info("🔄 No active sessions found, creating new ones...")
                    self._sessions = await self.client.create_all_sessions()
                    self.connectors = [session.connector for session in self._sessions.values()]
                    logger.info(f"✅ Created {len(self._sessions)} new sessions")

                # Create LangChain tools directly from the client using the adapter
                await self.adapter.create_all(self.client)
                self._tools = self.adapter.tools + self.adapter.resources + self.adapter.prompts
                logger.info(f"🛠️ Created {len(self._tools)} LangChain tools from client")
            else:
                # Using direct connector - only establish connection
                # LangChainAdapter will handle initialization
                connectors_to_use = self.connectors
                logger.info(f"🔗 Connecting to {len(connectors_to_use)} direct connectors...")
                for connector in connectors_to_use:
                    if not hasattr(connector, "client_session") or connector.client_session is None:
                        await connector.connect()

                # Create LangChain tools using the adapter with connectors
                await self.adapter._create_tools_from_connectors(connectors_to_use)
                await self.adapter._create_resources_from_connectors(connectors_to_use)
                await self.adapter._create_prompts_from_connectors(connectors_to_use)
                self._tools = self.adapter.tools + self.adapter.resources + self.adapter.prompts
                logger.info(f"🛠️ Created {len(self._tools)} LangChain tools from connectors")

            # Get all tools for system message generation
            all_tools = self._tools
            logger.info(f"🧰 Found {len(all_tools)} tools across all connectors")

            # Create the system message based on available tools
            await self._create_system_message_from_tools(all_tools)

        # Create the agent
        self._agent_executor = self._create_agent()
        self._initialized = True
        logger.info("✨ Agent initialization complete")

    def _normalize_output(self, value: object) -> str:
        """Normalize model outputs into a plain text string."""
        try:
            if isinstance(value, str):
                return value

            # LangChain messages may have .content which is str or list-like
            content = getattr(value, "content", None)
            if content is not None:
                return self._normalize_output(content)

            if isinstance(value, list):
                parts: list[str] = []
                for item in value:
                    if isinstance(item, dict):
                        if "text" in item and isinstance(item["text"], str):
                            parts.append(item["text"])
                        elif "content" in item:
                            parts.append(self._normalize_output(item["content"]))
                        else:
                            # Fallback to str for unknown shapes
                            parts.append(str(item))
                    else:
                        # recurse on .content or str
                        part_content = getattr(item, "text", None)
                        if isinstance(part_content, str):
                            parts.append(part_content)
                        else:
                            parts.append(self._normalize_output(getattr(item, "content", item)))
                return "".join(parts)

            return str(value)

        except Exception:
            return str(value)

    async def _create_system_message_from_tools(self, tools: list[BaseTool]) -> None:
        """Create the system message based on provided tools using the builder."""
        # Use the override if provided, otherwise use the imported default
        default_template = self.system_prompt_template_override or DEFAULT_SYSTEM_PROMPT_TEMPLATE
        # Server manager template is now also imported
        server_template = SERVER_MANAGER_SYSTEM_PROMPT_TEMPLATE

        # Delegate creation to the imported function
        self._system_message = create_system_message(
            tools=tools,
            system_prompt_template=default_template,
            server_manager_template=server_template,  # Pass the imported template
            use_server_manager=self.use_server_manager,
            disallowed_tools=self.disallowed_tools,
            user_provided_prompt=self.system_prompt,
            additional_instructions=self.additional_instructions,
        )

        # Update conversation history if memory is enabled
        # Note: The system message should not be included in the conversation history,
        # as it will be automatically added using the create_tool_calling_agent function with the prompt parameter
        if self.memory_enabled:
            self._conversation_history = [
                msg for msg in self._conversation_history if not isinstance(msg, SystemMessage)
            ]

    def _create_agent(self):
        """Create the LangChain agent with the configured system message.

        Returns:
            An initialized AgentExecutor.
        """
        logger.debug(f"Creating new agent with {len(self._tools)} tools")

        system_content = "You are a helpful assistant"
        if self._system_message:
            system_content = self._system_message.content

        tool_names = [tool.name for tool in self._tools]
        logger.info(f"🧠 Agent ready with tools: {', '.join(tool_names)}")

        # Create middleware to enforce max_steps
        # ModelCallLimitMiddleware limits the number of model calls, which corresponds to agent steps
        middleware = [ModelCallLimitMiddleware(run_limit=self.max_steps)]

        # Use the standard create_agent with middleware
        agent = create_agent(
            model=self.llm, tools=self._tools, system_prompt=system_content, middleware=middleware, debug=self.verbose
        )

        logger.debug(
            f"Created agent with max_steps={self.max_steps} (via ModelCallLimitMiddleware) "
            f"and {len(self.callbacks)} callbacks"
        )
        return agent

    def get_conversation_history(self) -> list[BaseMessage]:
        """Get the current conversation history.

        Returns:
            The list of conversation messages.
        """
        return self._conversation_history

    def clear_conversation_history(self) -> None:
        """Clear the conversation history."""
        self._conversation_history = []

    def add_to_history(self, message: BaseMessage) -> None:
        """Add a message to the conversation history.

        Args:
            message: The message to add.
        """
        if self.memory_enabled:
            self._conversation_history.append(message)

    def get_system_message(self) -> SystemMessage | None:
        """Get the current system message.

        Returns:
            The current system message, or None if not set.
        """
        return self._system_message

    def set_system_message(self, message: str) -> None:
        """Set a new system message.

        Args:
            message: The new system message content.
        """
        self._system_message = SystemMessage(content=message)

        # Recreate the agent with the new system message if initialized
        if self._initialized and self._tools:
            self._agent_executor = self._create_agent()
            logger.debug("Agent recreated with new system message")

    def set_disallowed_tools(self, disallowed_tools: list[str]) -> None:
        """Set the list of tools that should not be available to the agent.

        This will take effect the next time the agent is initialized.

        Args:
            disallowed_tools: List of tool names that should not be available.
        """
        self.disallowed_tools = disallowed_tools
        self.adapter.disallowed_tools = disallowed_tools

        # If the agent is already initialized, we need to reinitialize it
        # to apply the changes to the available tools
        if self._initialized:
            logger.debug("Agent already initialized. Changes will take effect on next initialization.")
            # We don't automatically reinitialize here as it could be disruptive
            # to ongoing operations. The user can call initialize() explicitly if needed.

    def get_disallowed_tools(self) -> list[str]:
        """Get the list of tools that are not available to the agent.

        Returns:
            List of tool names that are not available.
        """
        return self.disallowed_tools


    async def _consume_and_return(
        self,
        generator: AsyncGenerator[str | T, None],
    ) -> tuple[str | T, int]:
        """Consume the stream generator and return the final result.

        This is used by the run() method with the astream implementation.

        Args:
            generator: The async generator from astream.

        Returns:
            The final result (string or Pydantic model instance for structured output).
        """
        final_result = ""
        async for item in generator:
            # The last item yielded is always the final result
            final_result = item
        # Count steps as the number of tools used during execution
        steps_taken = len(self.tools_used_names)
        return final_result, steps_taken

    @telemetry("agent_run")
    async def run(
        self,
        query: str,
        max_steps: int | None = None,
        manage_connector: bool = True,
        external_history: list[BaseMessage] | None = None,
        output_schema: type[T] | None = None,
    ) -> str | T:
        """Run a query using LangChain 1.0.0's agent and return the final result.

        Args:
            query: The query to run.
            max_steps: Optional maximum number of steps to take.
            manage_connector: Whether to handle the connector lifecycle internally.
            external_history: Optional external history to use instead of the
                internal conversation history.
            output_schema: Optional Pydantic BaseModel class for structured output.

        Returns:
            The result of running the query as a string, or if output_schema is provided,
            an instance of the specified Pydantic model.

        Example:
            ```python
            # Regular usage
            result = await agent.run_v2("What's the weather like?")

            # Structured output usage
            from pydantic import BaseModel, Field

            class WeatherInfo(BaseModel):
                temperature: float = Field(description="Temperature in Celsius")
                condition: str = Field(description="Weather condition")

            weather: WeatherInfo = await agent.run_v2(
                "What's the weather like?",
                output_schema=WeatherInfo
            )
            ```
        """
        # Delegate to remote agent if in remote mode
        if self._is_remote and self._remote_agent:
            result = await self._remote_agent.run(query, max_steps, external_history, output_schema)
            return result

        success = True
        start_time = time.time()

        generator = self.stream(
            query, max_steps, manage_connector, external_history, output_schema=output_schema
        )
        error = None
        result = None
        steps_taken = 0
        try:
            result = await self._consume_and_return(generator)

        except Exception as e:
            success = False
            error = str(e)
            logger.error(f"❌ Error during agent execution: {e}")
            raise
        finally:
            self.telemetry.track_agent_execution(
                execution_method="run_v2",
                query=query,
                success=success,
                model_provider=self._model_provider,
                model_name=self._model_name,
                server_count=len(self.client.get_all_active_sessions()) if self.client else len(self.connectors),
                server_identifiers=[connector.public_identifier for connector in self.connectors],
                total_tools_available=len(self._tools) if self._tools else 0,
                tools_available_names=[tool.name for tool in self._tools],
                max_steps_configured=self.max_steps,
                memory_enabled=self.memory_enabled,
                use_server_manager=self.use_server_manager,
                max_steps_used=max_steps,
                manage_connector=manage_connector,
                external_history_used=external_history is not None,
                steps_taken=0,  # Not tracked in simplified version
                tools_used_count=len(self.tools_used_names),
                tools_used_names=self.tools_used_names,
                response=str(self._normalize_output(result)),
                execution_time_ms=int((time.time() - start_time) * 1000),
                error_type=error,
                conversation_history_length=len(self._conversation_history),
            )
        return result

    async def _attempt_structured_output(
        self, raw_result: str, structured_llm, output_schema: type[T], schema_description: str
    ) -> T:
        """Attempt to create structured output from raw result with validation."""
        format_prompt = f"""
        Please format the following information according to the specified schema.
        Extract and structure the relevant information from the content below.

        Required schema fields:
        {schema_description}

        Content to format:
        {raw_result}

        Please provide the information in the requested structured format.
        If any required information is missing, you must indicate this clearly.
        """

        structured_result = await structured_llm.ainvoke(format_prompt)

        try:
            for field_name, field_info in output_schema.model_fields.items():
                required = not hasattr(field_info, "default") or field_info.default is None
                if required:
                    value = getattr(structured_result, field_name, None)
                    if value is None or (isinstance(value, str) and not value.strip()):
                        raise ValueError(f"Required field '{field_name}' is missing or empty")
                    if isinstance(value, list) and len(value) == 0:
                        raise ValueError(f"Required field '{field_name}' is an empty list")
        except Exception as e:
            logger.debug(f"Validation details: {e}")
            raise  # Re-raise to trigger retry logic

        return structured_result

    def _enhance_query_with_schema(self, query: str, output_schema: type[T]) -> str:
        """Enhance the query with schema information to make the agent aware of required fields."""
        schema_fields = []

        try:
            for field_name, field_info in output_schema.model_fields.items():
                description = getattr(field_info, "description", "") or field_name
                required = not hasattr(field_info, "default") or field_info.default is None
                schema_fields.append(f"- {field_name}: {description} {'(required)' if required else '(optional)'}")

            schema_description = "\n".join(schema_fields)
        except Exception as e:
            logger.warning(f"Could not extract schema details: {e}")
            schema_description = f"Schema: {output_schema.__name__}"

        # Enhance the query with schema awareness
        enhanced_query = f"""
        {query}

        IMPORTANT: Your response must include sufficient information to populate the following structured output:

        {schema_description}

        Make sure you gather ALL the required information during your task execution.
        If any required information is missing, continue working to find it.
        """

        return enhanced_query

    @telemetry("agent_stream")
    async def stream(
        self,
        query: str,
        max_steps: int | None = None,
        manage_connector: bool = True,
        external_history: list[BaseMessage] | None = None,
        track_execution: bool = True,
        output_schema: type[T] | None = None,
    ) -> AsyncGenerator[tuple[AgentAction, str] | str | T, None]:
        """Async generator using LangChain 1.0.0's create_agent and astream.

        This method leverages the LangChain 1.0.0 API where create_agent returns
        a CompiledStateGraph that handles the agent loop internally via astream.

        **Tool Updates with Server Manager:**
        When using server_manager mode, this method handles dynamic tool updates:
        - **Before execution:** Updates are applied immediately to the new stream
        - **During execution:** When tools change, we wait for a "safe restart point"
          (after tool results complete), then interrupt the stream, recreate the agent
          with new tools, and resume execution with accumulated messages.
        - **Safe restart points:** Only restart after tool results to ensure message
          pairs (tool_use + tool_result) are complete, satisfying LLM API requirements.
        - **Max restarts:** Limited to 3 restarts to prevent infinite loops

        This interrupt-and-restart approach ensures that tools added mid-execution
        (e.g., via connect_to_mcp_server) are immediately available to the agent,
        maintaining the same behavior as the legacy implementation while respecting
        API constraints.

        Args:
            query: The query to run.
            manage_connector: Whether to handle the connector lifecycle internally.
            external_history: Optional external history to use instead of the
                internal conversation history.
            output_schema: Optional Pydantic BaseModel class for structured output.

        Yields:
            Intermediate steps and final result from the agent execution.
        """
        # Delegate to remote agent if in remote mode
        if self._is_remote and self._remote_agent:
            async for item in self._remote_agent.stream(query, max_steps, external_history, output_schema):
                yield item
            return

        initialized_here = False
        start_time = time.time()
        success = False
        final_output = None
        steps_taken = 0

        try:
            # 1. Initialize if needed
            if manage_connector and not self._initialized:
                await self.initialize()
                initialized_here = True
            elif not self._initialized and self.auto_initialize:
                await self.initialize()
                initialized_here = True

            if not self._agent_executor:
                raise RuntimeError("MCP agent failed to initialize")

            # Check for tool updates before starting execution (if using server manager)
            if self.use_server_manager and self.server_manager:
                current_tools = self.server_manager.tools
                current_tool_names = {tool.name for tool in current_tools}
                existing_tool_names = {tool.name for tool in self._tools}

                if current_tool_names != existing_tool_names:
                    logger.info(
                        f"🔄 Tools changed before execution, updating agent. New tools: {', '.join(current_tool_names)}"
                    )
                    self._tools = current_tools
                    # Regenerate system message with ALL current tools
                    await self._create_system_message_from_tools(self._tools)
                    # Recreate the agent executor with the new tools and system message
                    self._agent_executor = self._create_agent()

            # 2. Build inputs for the agent
            history_to_use = external_history if external_history is not None else self._conversation_history

            # Convert messages to format expected by LangChain agent
            langchain_history = []
            for msg in history_to_use:
                if isinstance(msg, HumanMessage | AIMessage):
                    langchain_history.append(msg)

            inputs = {"messages": [*langchain_history, HumanMessage(content=query)]}

            display_query = query[:50].replace("\n", " ") + "..." if len(query) > 50 else query.replace("\n", " ")
            logger.info(f"💬 Received query: '{display_query}'")
            logger.info("🏁 Starting agent execution")

            # 3. Stream using the built-in astream from CompiledStateGraph
            # The agent graph handles the loop internally
            # With dynamic tool reload: if tools change mid-execution, we interrupt and restart
            max_restarts = 3  # Prevent infinite restart loops
            restart_count = 0
            accumulated_messages = list(langchain_history) + [HumanMessage(content=query)]
            pending_tool_calls = {}  # Map tool_call_id -> AgentAction

            while restart_count <= max_restarts:
                # Update inputs with accumulated messages
                inputs = {"messages": accumulated_messages}
                should_restart = False

                async for chunk in self._agent_executor.astream(
                    inputs,
                    stream_mode="updates",  # Get updates as they happen
                    config={"callbacks": self.callbacks},
                ):
                    # chunk is a dict with node names as keys
                    # The agent node will have 'messages' with the AI response
                    # The tools node will have 'messages' with tool calls and results

                    for node_name, node_output in chunk.items():
                        logger.debug(f"📦 Node '{node_name}' output: {node_output}")

                        # Extract messages from the node output and accumulate them
                        if node_output is not None and "messages" in node_output:
                            messages = node_output["messages"]
                            if not isinstance(messages, list):
                                messages = [messages]

                            # Add new messages to accumulated messages for potential restart
                            for msg in messages:
                                if msg not in accumulated_messages:
                                    accumulated_messages.append(msg)
                            for message in messages:
                                # Track tool calls
                                if hasattr(message, "tool_calls") and message.tool_calls:
                                    # Extract text content from message for the log
                                    log_text = ""
                                    if hasattr(message, "content"):
                                        if isinstance(message.content, str):
                                            log_text = message.content
                                        elif isinstance(message.content, list):
                                            # Extract text blocks from content array
                                            text_parts = [
                                                block.get("text", "") if isinstance(block, dict) else str(block)
                                                for block in message.content
                                                if isinstance(block, dict) and block.get("type") == "text"
                                            ]
                                            log_text = "\n".join(text_parts)

                                    for tool_call in message.tool_calls:
                                        tool_name = tool_call.get("name", "unknown")
                                        tool_input = tool_call.get("args", {})
                                        tool_call_id = tool_call.get("id")

                                        action = AgentAction(tool=tool_name, tool_input=tool_input, log=log_text)
                                        if tool_call_id:
                                            pending_tool_calls[tool_call_id] = action

                                        self.tools_used_names.append(tool_name)
                                        steps_taken += 1

                                        tool_input_str = str(tool_input)
                                        if len(tool_input_str) > 100:
                                            tool_input_str = tool_input_str[:97] + "..."
                                        logger.info(f"🔧 Tool call: {tool_name} with input: {tool_input_str}")

                                # Track tool results and yield AgentStep
                                if hasattr(message, "type") and message.type == "tool":
                                    observation = message.content
                                    tool_call_id = getattr(message, "tool_call_id", None)

                                    if tool_call_id and tool_call_id in pending_tool_calls:
                                        action = pending_tool_calls.pop(tool_call_id)
                                        yield (action, str(observation))

                                    observation_str = str(observation)
                                    if len(observation_str) > 100:
                                        observation_str = observation_str[:97] + "..."
                                    observation_str = observation_str.replace("\n", " ")
                                    logger.info(f"📄 Tool result: {observation_str}")

                                    # --- Check for tool updates after tool results (safe restart point) ---
                                    if self.use_server_manager and self.server_manager:
                                        current_tools = self.server_manager.tools
                                        current_tool_names = {tool.name for tool in current_tools}
                                        existing_tool_names = {tool.name for tool in self._tools}

                                        if current_tool_names != existing_tool_names:
                                            logger.info(
                                                f"🔄 Tools changed during execution. "
                                                f"New tools: {', '.join(current_tool_names)}"
                                            )
                                            self._tools = current_tools
                                            # Regenerate system message with ALL current tools
                                            await self._create_system_message_from_tools(self._tools)
                                            # Recreate the agent executor with the new tools and system message
                                            self._agent_executor = self._create_agent()

                                            # Set restart flag - safe to restart now after tool results
                                            should_restart = True
                                            restart_count += 1
                                            logger.info(
                                                f"🔃 Restarting execution with updated tools "
                                                f"(restart {restart_count}/{max_restarts})"
                                            )
                                            break  # Break out of the message loop

                                # Track final AI message (without tool calls = final response)
                                if isinstance(message, AIMessage) and not getattr(message, "tool_calls", None):
                                    final_output = self._normalize_output(message.content)
                                    logger.info("✅ Agent finished with output")

                        # Break out of node loop if restarting
                        if should_restart:
                            break

                    # Break out of chunk loop if restarting
                    if should_restart:
                        break

                # Check if we should restart or if execution completed
                if not should_restart:
                    # Execution completed successfully without tool changes
                    break

                # If we've hit max restarts, log warning and continue
                if restart_count > max_restarts:
                    logger.warning(f"⚠️ Max restarts ({max_restarts}) reached. Continuing with current tools.")
                    break

            # 4. Update conversation history
            if self.memory_enabled:
                self.add_to_history(HumanMessage(content=query))
                if final_output:
                    self.add_to_history(AIMessage(content=final_output))

            # 5. Handle structured output if requested
            if output_schema and final_output:
                try:
                    logger.info("🔧 Attempting structured output...")
                    structured_llm = self.llm.with_structured_output(output_schema)
                    # Get schema description
                    schema_fields = []
                    for field_name, field_info in output_schema.model_fields.items():
                        description = getattr(field_info, "description", "") or field_name
                        required = not hasattr(field_info, "default") or field_info.default is None
                        schema_fields.append(
                            f"- {field_name}: {description} " + ("(required)" if required else "(optional)")
                        )
                    schema_description = "\n".join(schema_fields)

                    structured_result = await self._attempt_structured_output(
                        final_output, structured_llm, output_schema, schema_description
                    )

                    if self.memory_enabled:
                        self.add_to_history(AIMessage(content=f"Structured result: {structured_result}"))

                    logger.info("✅ Structured output successful")
                    success = True
                    yield structured_result
                    return
                except Exception as e:
                    logger.error(f"❌ Structured output failed: {e}")
                    raise RuntimeError(f"Failed to generate structured output: {str(e)}") from e

            # 6. Yield final result
            logger.info(f"🎉 Agent execution complete in {time.time() - start_time:.2f} seconds")
            success = True
            yield final_output or "No output generated"

        except Exception as e:
            logger.error(f"❌ Error running query: {e}")
            if initialized_here and manage_connector:
                logger.info("🧹 Cleaning up resources after error")
                await self.close()
            raise

        finally:
            # Track comprehensive execution data
            execution_time_ms = int((time.time() - start_time) * 1000)

            server_count = 0
            if self.client:
                server_count = len(self.client.get_all_active_sessions())
            elif self.connectors:
                server_count = len(self.connectors)

            conversation_history_length = len(self._conversation_history) if self.memory_enabled else 0

            # Safely access _tools in case initialization failed
            tools_available = getattr(self, "_tools", [])

            if track_execution:
                self.telemetry.track_agent_execution(
                    execution_method="stream",
                    query=query,
                    success=success,
                    model_provider=self._model_provider,
                    model_name=self._model_name,
                    server_count=server_count,
                    server_identifiers=[connector.public_identifier for connector in self.connectors],
                    total_tools_available=len(tools_available),
                    tools_available_names=[tool.name for tool in tools_available],
                    max_steps_configured=self.max_steps,
                    memory_enabled=self.memory_enabled,
                    use_server_manager=self.use_server_manager,
                    max_steps_used=max_steps,
                    manage_connector=manage_connector,
                    external_history_used=external_history is not None,
                    steps_taken=steps_taken,
                    tools_used_count=len(self.tools_used_names),
                    tools_used_names=self.tools_used_names,
                    response=final_output,
                    execution_time_ms=execution_time_ms,
                    error_type=None if success else "execution_error",
                    conversation_history_length=conversation_history_length,
                )

            # Clean up if necessary
            if manage_connector and not self.client and initialized_here:
                logger.info("🧹 Closing agent after stream completion")
                await self.close()

    async def _generate_response_chunks_async(
        self,
        query: str,
        max_steps: int | None = None,
        manage_connector: bool = True,
        external_history: list[BaseMessage] | None = None,
    ) -> AsyncIterator[StreamEvent]:
        """Internal async generator yielding response chunks.

        The implementation purposefully keeps the logic compact:
        1. Ensure the agent is initialised (optionally handling connector
           lifecycle).
        2. Forward the *same* inputs we use for ``run`` to LangChain's
           ``AgentExecutor.astream``.
        3. Diff the growing ``output`` field coming from LangChain and yield
           only the new part so the caller receives *incremental* chunks.
        4. Persist conversation history when memory is enabled.
        """

        # 1. Initialise on-demand ------------------------------------------------
        initialised_here = False
        if (manage_connector and not self._initialized) or (not self._initialized and self.auto_initialize):
            await self.initialize()
            initialised_here = True

        if not self._agent_executor:
            raise RuntimeError("MCP agent failed to initialise – call initialise() first?")

        # 2. Build inputs --------------------------------------------------------
        self.max_steps = max_steps or self.max_steps

        # 3. Build inputs --------------------------------------------------------
        history_to_use = external_history if external_history is not None else self._conversation_history
        inputs = {"input": query, "chat_history": history_to_use}

        # 3. Stream & diff -------------------------------------------------------
        async for event in self._agent_executor.astream_events(inputs, config={"callbacks": self.callbacks}):
            if event.get("event") == "on_chain_end":
                output = event["data"]["output"]
                if isinstance(output, list):
                    for message in output:
                        # Filter out ToolMessage (equivalent to old ToolAgentAction)
                        # to avoid adding intermediate tool execution details to history
                        if isinstance(message, BaseMessage) and not isinstance(message, ToolMessage):
                            self.add_to_history(message)
            yield event

        if self.memory_enabled:
            self.add_to_history(HumanMessage(content=query))

        # 5. House-keeping -------------------------------------------------------
        # Restrict agent cleanup in _generate_response_chunks_async to only occur
        #  when the agent was initialized in this generator and is not client-managed
        #  and the user does want us to manage the connection.
        if not self.client and initialised_here and manage_connector:
            logger.info("🧹 Closing agent after generator completion")
            await self.close()

    @telemetry("agent_stream_events")
    async def stream_events(
        self,
        query: str,
        max_steps: int | None = None,
        manage_connector: bool = True,
        external_history: list[BaseMessage] | None = None,
    ) -> AsyncIterator[str]:
        """Asynchronous streaming interface.

        Example::

            async for chunk in agent.stream("hello"):
                print(chunk, end="|", flush=True)
        """
        start_time = time.time()
        success = False
        chunk_count = 0
        total_response_length = 0

        try:
            async for chunk in self._generate_response_chunks_async(
                query=query,
                max_steps=max_steps,
                manage_connector=manage_connector,
                external_history=external_history,
            ):
                chunk_count += 1
                if isinstance(chunk, str):
                    total_response_length += len(chunk)
                yield chunk
            success = True
        finally:
            # Track comprehensive execution data for streaming
            execution_time_ms = int((time.time() - start_time) * 1000)

            server_count = 0
            if self.client:
                server_count = len(self.client.get_all_active_sessions())
            elif self.connectors:
                server_count = len(self.connectors)

            conversation_history_length = len(self._conversation_history) if self.memory_enabled else 0

            self.telemetry.track_agent_execution(
                execution_method="stream_events",
                query=query,
                success=success,
                model_provider=self._model_provider,
                model_name=self._model_name,
                server_count=server_count,
                server_identifiers=[connector.public_identifier for connector in self.connectors],
                total_tools_available=len(self._tools) if self._tools else 0,
                tools_available_names=[tool.name for tool in self._tools],
                max_steps_configured=self.max_steps,
                memory_enabled=self.memory_enabled,
                use_server_manager=self.use_server_manager,
                max_steps_used=max_steps,
                manage_connector=manage_connector,
                external_history_used=external_history is not None,
                response=f"[STREAMED RESPONSE - {total_response_length} chars]",
                execution_time_ms=execution_time_ms,
                error_type=None if success else "streaming_error",
                conversation_history_length=conversation_history_length,
            )

    async def close(self) -> None:
        """Close the MCP connection with improved error handling."""
        # Delegate to remote agent if in remote mode
        if self._is_remote and self._remote_agent:
            await self._remote_agent.close()
            return

        logger.info("🔌 Closing agent and cleaning up resources...")
        try:
            # Clean up the agent first
            self._agent_executor = None
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
            self._agent_executor = None
            if hasattr(self, "_tools"):
                self._tools = []
            if hasattr(self, "_sessions"):
                self._sessions = {}
            self._initialized = False
