"""
Utility functions for telemetry.

This module provides utilities for:
- Extracting model information from LangChain LLMs
- Converting MCP types to telemetry types
- High-level telemetry tracking helpers
"""

import importlib.metadata
import json
from typing import TYPE_CHECKING, Any

from langchain_core.language_models import BaseLanguageModel
from mcp.types import (
    EmbeddedResource,
    ImageContent,
    Implementation,
    Prompt,
    Resource,
    TextContent,
    Tool,
)

from mcp_use.telemetry.events import (
    AdapterUsageEvent,
    TelemetryClientInfo,
    TelemetryContent,
    TelemetryPrompt,
    TelemetryResource,
    TelemetryTool,
)

if TYPE_CHECKING:
    from mcp_use.server.server import MCPServer
    from mcp_use.telemetry.telemetry import Telemetry


def get_package_version() -> str:
    """Get the current mcp-use package version."""
    try:
        return importlib.metadata.version("mcp-use")
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def get_model_provider(llm: BaseLanguageModel) -> str:
    """Extract the model provider from LangChain LLM using BaseChatModel standards."""
    # Use LangChain's standard _llm_type property for identification
    return getattr(llm, "_llm_type", llm.__class__.__name__.lower())


def get_model_name(llm: BaseLanguageModel) -> str:
    """Extract the model name from LangChain LLM using BaseChatModel standards."""
    # First try _identifying_params which may contain model info
    if hasattr(llm, "_identifying_params"):
        identifying_params = llm._identifying_params
        if isinstance(identifying_params, dict):
            # Common keys that contain model names
            for key in ["model", "model_name", "model_id", "deployment_name"]:
                if key in identifying_params:
                    return str(identifying_params[key])

    # Fallback to direct model attributes
    return getattr(llm, "model", getattr(llm, "model_name", llm.__class__.__name__))


def extract_model_info(llm: BaseLanguageModel) -> tuple[str, str]:
    """Extract both provider and model name from LangChain LLM.

    Returns:
        Tuple of (provider, model_name)
    """
    return get_model_provider(llm), get_model_name(llm)


def safe_get(obj: Any, key: str, default: Any = None) -> Any:
    """Safely get value from dict or object attribute"""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def tool_to_telemetry(tool: Tool) -> TelemetryTool:
    """Convert MCP Tool to TelemetryTool"""
    return TelemetryTool(
        name=tool.name,
        title=safe_get(tool, "title"),
        description=safe_get(tool, "description"),
        input_schema=json.dumps(tool.inputSchema) if safe_get(tool, "inputSchema") else None,
        output_schema=None,  # MCP tools don't have output schema in the type
    )


def resource_to_telemetry(resource: Resource) -> TelemetryResource:
    """Convert MCP Resource to TelemetryResource"""
    return TelemetryResource(
        name=resource.name,
        title=safe_get(resource, "title"),
        description=safe_get(resource, "description"),
        uri=str(resource.uri),
        mimeType=safe_get(resource, "mimeType"),
    )


def prompt_to_telemetry(prompt: Prompt) -> TelemetryPrompt:
    """Convert MCP Prompt to TelemetryPrompt"""
    # Failsafe: if arguments exist, take the first and serialize as a string, else None
    if prompt.arguments and len(prompt.arguments) > 0:
        first_arg = prompt.arguments[0]
        args = json.dumps(first_arg.model_dump())
    else:
        args = None
    return TelemetryPrompt(
        name=prompt.name,
        title=safe_get(prompt, "title"),
        description=safe_get(prompt, "description"),
        args=args,
    )


def content_to_telemetry(content: TextContent | ImageContent | EmbeddedResource) -> TelemetryContent:
    """Convert MCP Content to TelemetryContent"""
    if isinstance(content, TextContent):
        text_len = len(content.text) if content.text else 0
        return TelemetryContent(
            mimeType=safe_get(content, "mimeType"),
            text=f"[text: {text_len} chars]",
            blob=None,
        )
    elif isinstance(content, ImageContent):
        return TelemetryContent(
            mimeType=content.mimeType,
            text=None,
            blob=f"[image: {content.mimeType}]",
        )
    elif isinstance(content, EmbeddedResource):
        return TelemetryContent(
            mimeType=None,
            text=f"[embedded resource: {content.resource.uri}]",
            blob=None,
        )
    else:
        return TelemetryContent(mimeType=None, text=None, blob=None)


def client_info_to_telemetry(client_info: Implementation) -> TelemetryClientInfo:
    """Convert MCP Implementation (ClientInfo) to TelemetryClientInfo"""
    return TelemetryClientInfo(
        name=client_info.name,
        version=client_info.version,
        title=None,  # Not in Implementation type
        description=None,  # Not in Implementation type
        websiteUrl=None,  # Not in Implementation type
    )


def capabilities_to_json(capabilities: dict[str, Any] | Any) -> str:
    """Convert capabilities to JSON string"""
    try:
        return json.dumps(capabilities)
    except Exception:
        return "{}"


def track_agent_execution_from_agent(
    agent: "Any",  # MCPAgent
    execution_method: str,
    query: str,
    success: bool,
    execution_time_ms: int,
    max_steps_used: int | None = None,
    manage_connector: bool = True,
    external_history_used: bool = False,
    steps_taken: int | None = None,
    response: str | None = None,
    error_type: str | None = None,
) -> None:
    """Track agent execution by extracting data from the agent instance.

    Args:
        agent: The MCPAgent instance
        execution_method: Method used ("run", "stream", "stream_events", etc.)
        query: The user query
        success: Whether execution succeeded
        execution_time_ms: Execution time in milliseconds
        max_steps_used: Maximum steps used (if different from configured)
        manage_connector: Whether connector was managed
        external_history_used: Whether external history was provided
        steps_taken: Number of steps taken
        response: The response (or summary for streaming)
        error_type: Error type if failed
    """
    server_count = len(agent.client.get_all_active_sessions()) if agent.client else len(agent.connectors)
    server_identifiers = [{"identifier": connector.public_identifier} for connector in agent.connectors]

    tools_available = agent._tools or []
    total_tools_available = len(tools_available)
    tools_available_names = [tool.name for tool in tools_available]

    agent.telemetry.track_agent_execution(
        execution_method=execution_method,
        query=query,
        success=success,
        model_provider=agent._model_provider,
        model_name=agent._model_name,
        server_count=server_count,
        server_identifiers=server_identifiers,
        total_tools_available=total_tools_available,
        tools_available_names=tools_available_names,
        max_steps_configured=agent.max_steps,
        memory_enabled=agent.memory_enabled,
        use_server_manager=agent.use_server_manager,
        max_steps_used=max_steps_used,
        manage_connector=manage_connector,
        external_history_used=external_history_used,
        steps_taken=steps_taken,
        tools_used_count=len(agent.tools_used_names),
        tools_used_names=agent.tools_used_names,
        response=response,
        execution_time_ms=execution_time_ms,
        error_type=error_type,
        conversation_history_length=len(agent._conversation_history),
    )


def track_server_run_from_server(
    server: "MCPServer",
    transport: str,
    host: str,
    port: int,
    telemetry: "Telemetry",
) -> None:
    """Track server run event by extracting data from the server instance.

    Args:
        server: The MCPServer instance
        transport: Transport type being used
        host: Host address
        port: Port number
        telemetry: Telemetry instance to use for tracking
    """
    tools_list = list(server._tool_manager._tools.values())
    resources_list = list(server._resource_manager._resources.values())
    prompts_list = list(server._prompt_manager._prompts.values())

    tool_names = [tool.name for tool in tools_list]
    tools_telemetry = [tool_to_telemetry(tool) for tool in tools_list]

    resource_names = [resource.name for resource in resources_list]
    resources_telemetry = [resource_to_telemetry(resource) for resource in resources_list]

    prompt_names = [prompt.name for prompt in prompts_list]
    prompts_telemetry = [prompt_to_telemetry(prompt) for prompt in prompts_list]

    base_url = None
    if transport in ("streamable-http", "sse"):
        base_url = f"http://{host}:{port}"

    has_auth = False

    capabilities_dict = {
        "tools": len(tools_list) > 0,
        "resources": len(resources_list) > 0,
        "prompts": len(prompts_list) > 0,
    }
    capabilities_json = capabilities_to_json(capabilities_dict)

    telemetry.track_server_run(
        transport=transport,
        tools_number=len(tools_list),
        resources_number=len(resources_list),
        prompts_number=len(prompts_list),
        auth=has_auth,
        name=server.name,
        description=server.instructions,
        base_url=base_url,
        tool_names=tool_names,
        resource_names=resource_names,
        prompt_names=prompt_names,
        tools=tools_telemetry,
        resources=resources_telemetry,
        prompts=prompts_telemetry,
        templates=None,
        capabilities=capabilities_json,
        apps_sdk_resources=None,
        mcp_ui_resources=None,
    )


def track_adapter_usage(
    adapter: "Any",  # BaseAdapter
    operation: str,
    telemetry: "Telemetry",
) -> None:
    """Track adapter usage by extracting data from the adapter instance.

    Args:
        adapter: The BaseAdapter instance
        operation: Operation being performed ("create_tools", "create_resources", "create_prompts", "create_all")
        telemetry: Telemetry instance to use for tracking
    """
    telemetry.capture(
        event=AdapterUsageEvent(
            operation=operation,
            framework=adapter.framework,
        )
    )
