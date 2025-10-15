import logging
import os
import platform
import uuid
from collections.abc import Callable
from functools import wraps
from pathlib import Path
from typing import Any

from posthog import Posthog
from scarf import ScarfEventLogger

from mcp_use.logging import MCP_USE_DEBUG
from mcp_use.telemetry.events import BaseTelemetryEvent, MCPAgentExecutionEvent
from mcp_use.telemetry.utils import get_package_version
from mcp_use.utils import singleton

logger = logging.getLogger(__name__)


def requires_telemetry(func: Callable) -> Callable:
    """Decorator that skips function execution if telemetry is disabled"""

    @wraps(func)
    def wrapper(self, *args, **kwargs):
        if not self._posthog_client and not self._scarf_client:
            return None
        return func(self, *args, **kwargs)

    return wrapper


def get_cache_home() -> Path:
    """Get platform-appropriate cache directory."""
    # XDG_CACHE_HOME for Linux and manually set envs
    env_var: str | None = os.getenv("XDG_CACHE_HOME")
    if env_var and (path := Path(env_var)).is_absolute():
        return path

    system = platform.system()
    if system == "Windows":
        appdata = os.getenv("LOCALAPPDATA") or os.getenv("APPDATA")
        if appdata:
            return Path(appdata)
        return Path.home() / "AppData" / "Local"
    elif system == "Darwin":  # macOS
        return Path.home() / "Library" / "Caches"
    else:  # Linux or other Unix
        return Path.home() / ".cache"


@singleton
class Telemetry:
    """
    Service for capturing anonymized telemetry data via PostHog and Scarf.
    If the environment variable `MCP_USE_ANONYMIZED_TELEMETRY=false`, telemetry will be disabled.
    """

    USER_ID_PATH = str(get_cache_home() / "mcp_use_3" / "telemetry_user_id")
    VERSION_DOWNLOAD_PATH = str(get_cache_home() / "mcp_use" / "download_version")
    PROJECT_API_KEY = "phc_lyTtbYwvkdSbrcMQNPiKiiRWrrM1seyKIMjycSvItEI"
    HOST = "https://eu.i.posthog.com"
    SCARF_GATEWAY_URL = "https://mcpuse.gateway.scarf.sh/events"
    UNKNOWN_USER_ID = "UNKNOWN_USER_ID"

    _curr_user_id = None

    def __init__(self):
        telemetry_disabled = os.getenv("MCP_USE_ANONYMIZED_TELEMETRY", "true").lower() == "false"

        if telemetry_disabled:
            self._posthog_client = None
            self._scarf_client = None
            logger.debug("Telemetry disabled")
        else:
            logger.info("Anonymized telemetry enabled. Set MCP_USE_ANONYMIZED_TELEMETRY=false to disable.")

            # Initialize PostHog
            try:
                self._posthog_client = Posthog(
                    project_api_key=self.PROJECT_API_KEY,
                    host=self.HOST,
                    disable_geoip=False,
                    enable_exception_autocapture=True,
                )

                # Silence posthog's logging unless debug mode (level 2)
                if MCP_USE_DEBUG < 2:
                    posthog_logger = logging.getLogger("posthog")
                    posthog_logger.disabled = True

            except Exception as e:
                logger.warning(f"Failed to initialize PostHog telemetry: {e}")
                self._posthog_client = None

            # Initialize Scarf
            try:
                self._scarf_client = ScarfEventLogger(
                    endpoint_url=self.SCARF_GATEWAY_URL,
                    timeout=3.0,
                    verbose=MCP_USE_DEBUG >= 2,
                )

                # Silence scarf's logging unless debug mode (level 2)
                if MCP_USE_DEBUG < 2:
                    scarf_logger = logging.getLogger("scarf")
                    scarf_logger.disabled = True

            except Exception as e:
                logger.warning(f"Failed to initialize Scarf telemetry: {e}")
                self._scarf_client = None

    @property
    def user_id(self) -> str:
        """Get or create a persistent anonymous user ID"""
        if self._curr_user_id:
            return self._curr_user_id

        try:
            is_first_time = not os.path.exists(self.USER_ID_PATH)

            if is_first_time:
                logger.debug(f"Creating user ID path: {self.USER_ID_PATH}")
                os.makedirs(os.path.dirname(self.USER_ID_PATH), exist_ok=True)
                with open(self.USER_ID_PATH, "w") as f:
                    new_user_id = str(uuid.uuid4())
                    f.write(new_user_id)
                self._curr_user_id = new_user_id

                logger.debug(f"User ID path created: {self.USER_ID_PATH}")
            else:
                with open(self.USER_ID_PATH) as f:
                    self._curr_user_id = f.read().strip()

            # Always check for version-based download tracking
            self.track_package_download(
                {
                    "triggered_by": "user_id_property",
                }
            )
        except Exception as e:
            logger.debug(f"Failed to get/create user ID: {e}")
            self._curr_user_id = self.UNKNOWN_USER_ID

        return self._curr_user_id

    @requires_telemetry
    def capture(self, event: BaseTelemetryEvent) -> None:
        """Capture a telemetry event"""
        # Send to PostHog
        if self._posthog_client:
            try:
                # Add package version to all events
                properties = event.properties.copy()
                properties["mcp_use_version"] = get_package_version()

                self._posthog_client.capture(distinct_id=self.user_id, event=event.name, properties=properties)
            except Exception as e:
                logger.debug(f"Failed to track PostHog event {event.name}: {e}")

        # Send to Scarf
        if self._scarf_client:
            try:
                # Add package version and user_id to all events
                properties = {}
                properties["mcp_use_version"] = get_package_version()
                properties["user_id"] = self.user_id
                properties["event"] = event.name

                # Convert complex types to simple types for Scarf compatibility
                self._scarf_client.log_event(properties=properties)
            except Exception as e:
                logger.debug(f"Failed to track Scarf event {event.name}: {e}")

    @requires_telemetry
    def track_package_download(self, properties: dict[str, Any] | None = None) -> None:
        """Track package download event specifically for Scarf analytics"""
        if self._scarf_client:
            try:
                current_version = get_package_version()
                should_track = False
                first_download = False

                # Check if version file exists
                if not os.path.exists(self.VERSION_DOWNLOAD_PATH):
                    # First download
                    should_track = True
                    first_download = True

                    # Create directory and save version
                    os.makedirs(os.path.dirname(self.VERSION_DOWNLOAD_PATH), exist_ok=True)
                    with open(self.VERSION_DOWNLOAD_PATH, "w") as f:
                        f.write(current_version)
                else:
                    # Read saved version
                    with open(self.VERSION_DOWNLOAD_PATH) as f:
                        saved_version = f.read().strip()

                    # Compare versions (simple string comparison for now)
                    if current_version > saved_version:
                        should_track = True
                        first_download = False

                        # Update saved version
                        with open(self.VERSION_DOWNLOAD_PATH, "w") as f:
                            f.write(current_version)

                if should_track:
                    logger.debug(f"Tracking package download event with properties: {properties}")
                    # Add package version and user_id to event
                    event_properties = (properties or {}).copy()
                    event_properties["mcp_use_version"] = current_version
                    event_properties["user_id"] = self.user_id
                    event_properties["event"] = "package_download"
                    event_properties["first_download"] = first_download

                    # Convert complex types to simple types for Scarf compatibility
                    self._scarf_client.log_event(properties=event_properties)
            except Exception as e:
                logger.debug(f"Failed to track Scarf package_download event: {e}")

    @requires_telemetry
    def track_agent_execution(
        self,
        execution_method: str,
        query: str,
        success: bool,
        model_provider: str,
        model_name: str,
        server_count: int,
        server_identifiers: list[dict[str, str]],
        total_tools_available: int,
        tools_available_names: list[str],
        max_steps_configured: int,
        memory_enabled: bool,
        use_server_manager: bool,
        max_steps_used: int | None,
        manage_connector: bool,
        external_history_used: bool,
        steps_taken: int | None = None,
        tools_used_count: int | None = None,
        tools_used_names: list[str] | None = None,
        response: str | None = None,
        execution_time_ms: int | None = None,
        error_type: str | None = None,
        conversation_history_length: int | None = None,
    ) -> None:
        """Track comprehensive agent execution"""
        event = MCPAgentExecutionEvent(
            execution_method=execution_method,
            query=query,
            success=success,
            model_provider=model_provider,
            model_name=model_name,
            server_count=server_count,
            server_identifiers=server_identifiers,
            total_tools_available=total_tools_available,
            tools_available_names=tools_available_names,
            max_steps_configured=max_steps_configured,
            memory_enabled=memory_enabled,
            use_server_manager=use_server_manager,
            max_steps_used=max_steps_used,
            manage_connector=manage_connector,
            external_history_used=external_history_used,
            steps_taken=steps_taken,
            tools_used_count=tools_used_count,
            tools_used_names=tools_used_names,
            response=response,
            execution_time_ms=execution_time_ms,
            error_type=error_type,
            conversation_history_length=conversation_history_length,
        )
        self.capture(event)

    @requires_telemetry
    def flush(self) -> None:
        """Flush any queued telemetry events"""
        # Flush PostHog
        if self._posthog_client:
            try:
                self._posthog_client.flush()
                logger.debug("PostHog client telemetry queue flushed")
            except Exception as e:
                logger.debug(f"Failed to flush PostHog client: {e}")

        # Scarf events are sent immediately, no flush needed
        if self._scarf_client:
            logger.debug("Scarf telemetry events sent immediately (no flush needed)")

    @requires_telemetry
    def shutdown(self) -> None:
        """Shutdown telemetry clients and flush remaining events"""
        # Shutdown PostHog
        if self._posthog_client:
            try:
                self._posthog_client.shutdown()
                logger.debug("PostHog client shutdown successfully")
            except Exception as e:
                logger.debug(f"Error shutting down PostHog client: {e}")

        # Scarf doesn't require explicit shutdown
        if self._scarf_client:
            logger.debug("Scarf telemetry client shutdown (no action needed)")
