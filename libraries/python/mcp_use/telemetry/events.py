from dataclasses import dataclass, field
from typing import Any


@dataclass
class BaseEvent:
    language: str = field(default="python", init=False)
    mcp_use_version: str = field(default="unknown", init=False)
    source: str = field(default="python", init=False)


@dataclass
class GenericTelemetryEvent(BaseEvent):
    EVENT_NAME: str
    # we keep this for storing all dynamic props in one place as well
    properties: dict[str, Any] = field(default_factory=dict, repr=False)

    def __init__(self, EVENT_NAME: str, **properties: Any) -> None:
        # assign the "normal" field
        self.EVENT_NAME = EVENT_NAME

        # store all extra kwargs in the properties dict
        self.properties = properties

        # also expose them as attributes on the instance
        for key, value in properties.items():
            setattr(self, key, value)


@dataclass
class MCPAgentExecutionEvent(BaseEvent):
    EVENT_NAME: str = field(default="mcp_agent_execution", init=False)

    execution_method: str
    query: str
    query_length: int
    success: bool
    model_provider: str
    model_name: str
    server_count: int
    server_identifiers: list[dict[str, str]]
    total_tools_available: int
    tools_available_names: list[str]
    max_steps_configured: int
    memory_enabled: bool
    use_server_manager: bool
    # Execution PARAMETERS
    max_steps_used: int | None
    manage_connector: bool
    external_history_used: bool
    # Execution results
    steps_taken: int | None = None
    tools_used_count: int | None = None
    tools_used_names: list[str] | None = None
    response: str | None = None
    response_length: int | None = None
    execution_time_ms: int | None = None
    error_type: str | None = None
    # Context
    conversation_history_length: int | None = None


@dataclass
class ServerRunEvent(BaseEvent):
    EVENT_NAME: str = field(default="server_run", init=False)

    transport: str
    tools_number: int
    resources_number: int
    prompts_number: int
    auth: bool
    name: str
    description: str | None = None
    base_url: str | None = None
    tool_names: list[str] | None = None
    resource_names: list[str] | None = None
    prompt_names: list[str] | None = None
    tools: list["TelemetryTool"] | None = None
    resources: list["TelemetryResource"] | None = None
    prompts: list["TelemetryPrompt"] | None = None
    templates: list["TelemetryPrompt"] | None = None
    capabilities: str | None = None  # JSON stringified ServerCapabilities
    apps_sdk_resources: str | None = None  # JSON stringified
    mcp_ui_resources: str | None = None  # JSON stringified


@dataclass
class ServerInitializeEvent(BaseEvent):
    """Event for tracking server initialization calls"""

    EVENT_NAME: str = field(default="server_initialize_call", init=False)

    protocol_version: str
    client_info: "TelemetryClientInfo"
    client_capabilities: str  # JSON stringified capabilities
    session_id: str | None = None


@dataclass
class ServerToolCallEvent(BaseEvent):
    """Event for tracking server tool calls"""

    EVENT_NAME: str = field(default="server_tool_call", init=False)

    tool_name: str
    length_input_argument: int
    success: bool
    error_type: str | None = None
    execution_time_ms: int | None = None


@dataclass
class ServerResourceCallEvent(BaseEvent):
    """Event for tracking server resource calls"""

    EVENT_NAME: str = field(default="server_resource_call", init=False)

    name: str
    description: str | None
    contents: list["TelemetryContent"]
    success: bool
    error_type: str | None = None


@dataclass
class ServerPromptCallEvent(BaseEvent):
    """Event for tracking server prompt calls"""

    EVENT_NAME: str = field(default="server_prompt_call", init=False)

    name: str
    description: str | None
    success: bool
    error_type: str | None = None


@dataclass
class ServerContextEvent(BaseEvent):
    """Event for tracking server context operations (sample, elicit, notification)"""

    context_type: str = ""  # "sample", "elicit", or "notification"
    notification_type: str | None = None

    @property
    def EVENT_NAME(self) -> str:
        """Dynamic event name based on context type"""
        return f"server_context_{self.context_type}"


@dataclass
class MCPClientInitEvent(BaseEvent):
    """Event for tracking MCP client initialization"""

    EVENT_NAME: str = field(default="mcpclient_init", init=False)

    code_mode: bool
    sandbox: bool
    all_callbacks: bool
    verify: bool
    servers: list[str]
    num_servers: int


@dataclass
class ConnectorInitEvent(BaseEvent):
    """Event for tracking connector initialization"""

    EVENT_NAME: str = field(default="connector_init", init=False)

    connector_type: str
    server_command: str | None = None
    server_args: list[str] | None = None
    server_url: str | None = None
    public_identifier: str | None = None


@dataclass
class AdapterUsageEvent(BaseEvent):
    """Event for tracking adapter usage (create_tools, create_resources, create_prompts, create_all)"""

    EVENT_NAME: str = field(default="adapter_usage", init=False)
    operation: str  # "create_tools", "create_resources", "create_prompts", "create_all"
    framework: str  # "openai", "anthropic", "google", "unknown"


# Supporting dataclasses for telemetry - simplified versions of MCP types


@dataclass
class TelemetryTool:
    """Tool info for telemetry - simplified version of Tool type"""

    name: str
    title: str | None = None
    description: str | None = None
    input_schema: str | None = None  # JSON stringified schema
    output_schema: str | None = None  # JSON stringified schema


@dataclass
class TelemetryResource:
    """Resource info for telemetry - simplified version of Resource type"""

    name: str
    title: str | None = None
    description: str | None = None
    uri: str | None = None  # URI pattern
    mimeType: str | None = None  # MIME type


@dataclass
class TelemetryPrompt:
    """Prompt info for telemetry - simplified version of Prompt type"""

    name: str
    title: str | None = None
    description: str | None = None
    args: str | None = None  # JSON stringified args


@dataclass
class TelemetryContent:
    """Content info for telemetry - simplified version of Content type"""

    mimeType: str | None = None
    text: str | None = None  # Summarized as "[text: N chars]"
    blob: str | None = None  # Summarized as "[blob: N bytes]"


@dataclass
class TelemetryClientInfo:
    """Client info for telemetry - simplified version of ClientInfo type"""

    name: str
    version: str
    title: str | None = None
    description: str | None = None
    websiteUrl: str | None = None


# Type alias for all telemetry events
TelemetryEvent = (
    GenericTelemetryEvent
    | MCPAgentExecutionEvent
    | ServerRunEvent
    | ServerInitializeEvent
    | ServerToolCallEvent
    | ServerResourceCallEvent
    | ServerPromptCallEvent
    | ServerContextEvent
    | MCPClientInitEvent
    | ConnectorInitEvent
    | AdapterUsageEvent
)

# Export all event classes
__all__ = [
    "BaseEvent",
    "GenericTelemetryEvent",
    "MCPAgentExecutionEvent",
    "ServerRunEvent",
    "ServerInitializeEvent",
    "ServerToolCallEvent",
    "ServerResourceCallEvent",
    "ServerPromptCallEvent",
    "ServerContextEvent",
    "MCPClientInitEvent",
    "ConnectorInitEvent",
    "AdapterUsageEvent",
    "TelemetryTool",
    "TelemetryResource",
    "TelemetryPrompt",
    "TelemetryContent",
    "TelemetryClientInfo",
    "TelemetryEvent",
]
